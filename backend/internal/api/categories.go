package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/category"
	"github.com/ledger/backend/internal/db"
)

type CategoryMappingDTO struct {
	ID          string `json:"id"`
	RawCategory string `json:"raw_category"`
	GroupID     string `json:"group_id"`
	GroupName   string `json:"group_name,omitempty"`
}

type CategoryGroupDTO struct {
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	Mappings []CategoryMappingBrief `json:"mappings"`
}

type CategoryMappingBrief struct {
	ID          string `json:"id"`
	RawCategory string `json:"raw_category"`
}

func mappingToDTO(m db.ListCategoryMappingsRow) CategoryMappingDTO {
	return CategoryMappingDTO{
		ID:          m.ID.String(),
		RawCategory: m.RawCategory,
		GroupID:     m.GroupID.String(),
		GroupName:   m.GroupName,
	}
}

func (s *Server) handleListUnmappedCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q.ListUnmappedCategoryTexts(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load unmapped categories")
		return
	}
	if rows == nil {
		rows = []string{}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleListTransactionCategoryTexts(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)

	var search *string
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		search = &q
	}

	var excludeGroupID pgtype.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("exclude_group_id")); raw != "" {
		gid, err := uuid.Parse(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid exclude_group_id")
			return
		}
		if _, err := s.q.GetCategoryGroup(r.Context(), db.GetCategoryGroupParams{ID: gid, UserID: uid}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeErr(w, http.StatusNotFound, "category group not found")
				return
			}
			writeErr(w, http.StatusInternalServerError, "could not load category group")
			return
		}
		excludeGroupID = pgtype.UUID{Bytes: gid, Valid: true}
	}

	rows, err := s.q.ListTransactionCategoryTexts(r.Context(), db.ListTransactionCategoryTextsParams{
		UserID:         uid,
		Search:         search,
		ExcludeGroupID: excludeGroupID,
		Limit:          50,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load category text")
		return
	}
	if rows == nil {
		rows = []string{}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleListCategoryMappings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q.ListCategoryMappings(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load mappings")
		return
	}
	out := make([]CategoryMappingDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, mappingToDTO(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleListCategoryGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := s.q.ListCategoryGroups(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load category groups")
		return
	}
	out := make([]CategoryGroupDTO, 0, len(groups))
	for _, g := range groups {
		mappings, err := s.q.ListCategoryMappingsByGroup(r.Context(), db.ListCategoryMappingsByGroupParams{
			GroupID: g.ID,
			UserID:  userID(r),
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load category groups")
			return
		}
		dto := CategoryGroupDTO{ID: g.ID.String(), Name: g.Name, Mappings: make([]CategoryMappingBrief, 0, len(mappings))}
		for _, m := range mappings {
			dto.Mappings = append(dto.Mappings, CategoryMappingBrief{ID: m.ID.String(), RawCategory: m.RawCategory})
		}
		out = append(out, dto)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateCategoryGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}

	uid := userID(r)
	normName := category.NormalizeLabel(body.Name)
	if normName == "" {
		writeErr(w, http.StatusBadRequest, "name cannot be blank")
		return
	}

	grp, err := s.q.InsertCategoryGroup(r.Context(), db.InsertCategoryGroupParams{
		UserID: uid, Name: body.Name, NormalizedName: normName,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "a group with that name already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create category group")
		return
	}

	writeJSON(w, http.StatusCreated, CategoryGroupDTO{
		ID:       grp.ID.String(),
		Name:     grp.Name,
		Mappings: []CategoryMappingBrief{},
	})
}

func (s *Server) handleUpdateCategoryGroup(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	normName := category.NormalizeLabel(body.Name)
	if normName == "" {
		writeErr(w, http.StatusBadRequest, "name cannot be blank")
		return
	}

	grp, err := s.q.UpdateCategoryGroupName(r.Context(), db.UpdateCategoryGroupNameParams{
		ID: id, UserID: userID(r), Name: body.Name, NormalizedName: normName,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "category group not found")
			return
		}
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "a group with that name already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update category group")
		return
	}

	mappings, _ := s.q.ListCategoryMappingsByGroup(r.Context(), db.ListCategoryMappingsByGroupParams{
		GroupID: grp.ID, UserID: userID(r),
	})
	dto := CategoryGroupDTO{ID: grp.ID.String(), Name: grp.Name, Mappings: make([]CategoryMappingBrief, 0, len(mappings))}
	for _, m := range mappings {
		dto.Mappings = append(dto.Mappings, CategoryMappingBrief{ID: m.ID.String(), RawCategory: m.RawCategory})
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) handleDeleteCategoryGroup(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.q.DeleteCategoryGroup(r.Context(), db.DeleteCategoryGroupParams{ID: id, UserID: userID(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete category group")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCreateCategoryMapping(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RawCategory string  `json:"raw_category"`
		GroupID     *string `json:"group_id"`
		GroupName   *string `json:"group_name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.RawCategory == "" {
		writeErr(w, http.StatusBadRequest, "raw_category is required")
		return
	}
	if body.GroupID == nil && body.GroupName == nil {
		writeErr(w, http.StatusBadRequest, "group_id or group_name is required")
		return
	}
	if body.GroupID != nil && body.GroupName != nil {
		writeErr(w, http.StatusBadRequest, "provide group_id or group_name, not both")
		return
	}

	uid := userID(r)
	normCat := category.NormalizeLabel(body.RawCategory)
	if normCat == "" {
		writeErr(w, http.StatusBadRequest, "raw_category cannot be blank")
		return
	}

	ok, err := s.q.CategoryTextExistsForUser(r.Context(), db.CategoryTextExistsForUserParams{
		UserID: uid, Category: normCat,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not validate category text")
		return
	}
	if !ok {
		writeErr(w, http.StatusBadRequest, "category text does not exist in your transactions")
		return
	}

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create mapping")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	var groupID uuid.UUID
	var groupName string

	if body.GroupID != nil {
		gid, err := uuid.Parse(*body.GroupID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid group_id")
			return
		}
		grp, err := qtx.GetCategoryGroup(r.Context(), db.GetCategoryGroupParams{ID: gid, UserID: uid})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeErr(w, http.StatusNotFound, "category group not found")
				return
			}
			writeErr(w, http.StatusInternalServerError, "could not load category group")
			return
		}
		groupID = grp.ID
		groupName = grp.Name
	} else {
		name := *body.GroupName
		normName := category.NormalizeLabel(name)
		if normName == "" {
			writeErr(w, http.StatusBadRequest, "group_name cannot be blank")
			return
		}
		grp, err := qtx.InsertCategoryGroup(r.Context(), db.InsertCategoryGroupParams{
			UserID: uid, Name: name, NormalizedName: normName,
		})
		if err != nil {
			if isUniqueViolation(err) {
				writeErr(w, http.StatusConflict, "a group with that name already exists")
				return
			}
			writeErr(w, http.StatusInternalServerError, "could not create category group")
			return
		}
		groupID = grp.ID
		groupName = grp.Name
	}

	mapping, err := qtx.InsertCategoryMapping(r.Context(), db.InsertCategoryMappingParams{
		UserID: uid, RawCategory: body.RawCategory, NormalizedCategory: normCat, GroupID: groupID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "that category text is already in this group")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create mapping")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create mapping")
		return
	}

	writeJSON(w, http.StatusCreated, CategoryMappingDTO{
		ID: mapping.ID.String(), RawCategory: mapping.RawCategory,
		GroupID: groupID.String(), GroupName: groupName,
	})
}

func (s *Server) handleDeleteCategoryMapping(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	uid := userID(r)
	if _, err := s.q.GetCategoryMapping(r.Context(), db.GetCategoryMappingParams{ID: id, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "mapping not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load mapping")
		return
	}

	if err := s.q.DeleteCategoryMapping(r.Context(), db.DeleteCategoryMappingParams{ID: id, UserID: uid}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete mapping")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
