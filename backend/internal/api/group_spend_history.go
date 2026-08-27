package api

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type GroupSpendHistoryDTO struct {
	From         string                      `json:"from"`
	To           string                      `json:"to"`
	Months       int                         `json:"months"`
	MonthlyCosts []MonthlyCostBucketDTO      `json:"monthly_costs"`
	Groups       []GroupSpendHistoryGroupDTO `json:"groups"`
}

type MonthlyCostBucketDTO struct {
	Month string  `json:"month"`
	Total float64 `json:"total"`
}

type GroupSpendHistoryGroupDTO struct {
	GroupID   string                        `json:"group_id"`
	GroupName string                        `json:"group_name"`
	Mappings  []GroupSpendHistoryMappingDTO `json:"mappings"`
	Buckets   []GroupSpendHistoryBucketDTO  `json:"buckets"`
}

type GroupSpendHistoryMappingDTO struct {
	ID       string `json:"id"`
	Category string `json:"category"`
}

type GroupSpendHistoryBucketDTO struct {
	Month              string                         `json:"month"`
	Total              float64                        `json:"total"`
	TransactionCount   int64                          `json:"transaction_count"`
	AverageTransaction *float64                       `json:"average_transaction"`
	MedianTransaction  *float64                       `json:"median_transaction"`
	LargestTransaction *float64                       `json:"largest_transaction"`
	Categories         []GroupCategoryContributionDTO `json:"categories"`
}

type GroupCategoryContributionDTO struct {
	Category         string  `json:"category"`
	Total            float64 `json:"total"`
	TransactionCount int64   `json:"transaction_count"`
}

type historyAggregate struct {
	total         float64
	amounts       []float64
	contributions map[uuid.UUID]*historyContribution
}

type historyContribution struct {
	total float64
	count int64
}

func (s *Server) handleGetGroupSpendHistory(w http.ResponseWriter, r *http.Request) {
	toMonth := r.URL.Query().Get("to")
	if !monthRe.MatchString(toMonth) {
		writeErr(w, http.StatusBadRequest, "to must be YYYY-MM")
		return
	}
	_, toDate, err := monthDateRange(toMonth)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "to must be YYYY-MM")
		return
	}

	months, err := strconv.Atoi(r.URL.Query().Get("months"))
	if err != nil || (months != 3 && months != 6 && months != 12) {
		writeErr(w, http.StatusBadRequest, "months must be 3, 6, or 12")
		return
	}

	requested, err := parseHistoryGroupIDs(r.URL.Query().Get("group_ids"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid group_ids")
		return
	}

	toStart, _, _ := monthDateRange(toMonth)
	fromTime := toStart.Time.AddDate(0, -(months - 1), 0)
	fromDate := pgtype.Date{Time: fromTime, Valid: true}
	monthKeys := make([]string, months)
	for i := range monthKeys {
		monthKeys[i] = fromTime.AddDate(0, i, 0).Format("2006-01")
	}

	tx, err := s.pool.BeginTx(r.Context(), pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend history")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	uid := userID(r)

	allGroups, err := qtx.ListCategoryGroups(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend history")
		return
	}

	requestedSet := make(map[uuid.UUID]struct{}, len(requested))
	for _, id := range requested {
		requestedSet[id] = struct{}{}
	}
	selectedGroups := make([]db.CategoryGroup, 0, len(allGroups))
	selectedIDs := make([]uuid.UUID, 0, len(allGroups))
	for _, group := range allGroups {
		if len(requestedSet) > 0 {
			if _, ok := requestedSet[group.ID]; !ok {
				continue
			}
			delete(requestedSet, group.ID)
		}
		selectedGroups = append(selectedGroups, group)
		selectedIDs = append(selectedIDs, group.ID)
	}
	if len(requestedSet) > 0 {
		writeErr(w, http.StatusNotFound, "category group not found")
		return
	}

	mappingRows, err := qtx.ListCategoryMappings(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend history")
		return
	}
	mappingByID := make(map[uuid.UUID]db.ListCategoryMappingsRow, len(mappingRows))
	mappingsByGroup := make(map[uuid.UUID][]GroupSpendHistoryMappingDTO)
	selectedIDSet := make(map[uuid.UUID]struct{}, len(selectedIDs))
	for _, id := range selectedIDs {
		selectedIDSet[id] = struct{}{}
	}
	for _, mapping := range mappingRows {
		if _, ok := selectedIDSet[mapping.GroupID]; !ok {
			continue
		}
		mappingByID[mapping.ID] = mapping
		mappingsByGroup[mapping.GroupID] = append(mappingsByGroup[mapping.GroupID], GroupSpendHistoryMappingDTO{
			ID: mapping.ID.String(), Category: mapping.RawCategory,
		})
	}

	aggregates := make(map[uuid.UUID]map[string]*historyAggregate, len(selectedGroups))
	for _, group := range selectedGroups {
		aggregates[group.ID] = make(map[string]*historyAggregate, months)
		for _, month := range monthKeys {
			aggregates[group.ID][month] = &historyAggregate{contributions: make(map[uuid.UUID]*historyContribution)}
		}
	}

	if len(selectedIDs) > 0 {
		rows, err := qtx.ListGroupTransactionsForHistory(r.Context(), db.ListGroupTransactionsForHistoryParams{
			UserID: uid, GroupIds: selectedIDs, FromDate: fromDate, ToDate: toDate,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load group spend history")
			return
		}
		for _, row := range rows {
			month := row.TxnDate.Time.Format("2006-01")
			agg := aggregates[row.GroupID][month]
			amount := numToFloat(row.Amount)
			agg.total += amount
			agg.amounts = append(agg.amounts, amount)
			contribution := agg.contributions[row.MappingID]
			if contribution == nil {
				contribution = &historyContribution{}
				agg.contributions[row.MappingID] = contribution
			}
			contribution.total += amount
			contribution.count++
		}
	}

	monthlyCostRows, err := qtx.SumMonthlyCostByMonthRange(r.Context(), db.SumMonthlyCostByMonthRangeParams{
		UserID: uid, FromDate: fromDate, ToDate: toDate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend history")
		return
	}
	monthlyCostByMonth := make(map[string]float64, len(monthlyCostRows))
	for _, row := range monthlyCostRows {
		monthlyCostByMonth[row.Month] = numToFloat(row.Total)
	}

	out := GroupSpendHistoryDTO{
		From: monthKeys[0], To: toMonth, Months: months,
		MonthlyCosts: make([]MonthlyCostBucketDTO, 0, months),
		Groups:       make([]GroupSpendHistoryGroupDTO, 0, len(selectedGroups)),
	}
	for _, month := range monthKeys {
		out.MonthlyCosts = append(out.MonthlyCosts, MonthlyCostBucketDTO{Month: month, Total: monthlyCostByMonth[month]})
	}
	for _, group := range selectedGroups {
		groupDTO := GroupSpendHistoryGroupDTO{
			GroupID: group.ID.String(), GroupName: group.Name,
			Mappings: mappingsByGroup[group.ID],
			Buckets:  make([]GroupSpendHistoryBucketDTO, 0, months),
		}
		if groupDTO.Mappings == nil {
			groupDTO.Mappings = []GroupSpendHistoryMappingDTO{}
		}
		for _, month := range monthKeys {
			groupDTO.Buckets = append(groupDTO.Buckets, historyBucketDTO(month, aggregates[group.ID][month], mappingByID))
		}
		out.Groups = append(out.Groups, groupDTO)
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend history")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func parseHistoryGroupIDs(raw string) ([]uuid.UUID, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	seen := make(map[uuid.UUID]struct{})
	out := make([]uuid.UUID, 0)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, errors.New("empty group id")
		}
		id, err := uuid.Parse(part)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func historyBucketDTO(month string, agg *historyAggregate, mappings map[uuid.UUID]db.ListCategoryMappingsRow) GroupSpendHistoryBucketDTO {
	bucket := GroupSpendHistoryBucketDTO{
		Month: month, Total: agg.total, TransactionCount: int64(len(agg.amounts)),
		Categories: make([]GroupCategoryContributionDTO, 0, len(agg.contributions)),
	}
	if len(agg.amounts) > 0 {
		sort.Float64s(agg.amounts)
		average := agg.total / float64(len(agg.amounts))
		median := agg.amounts[len(agg.amounts)/2]
		if len(agg.amounts)%2 == 0 {
			median = (agg.amounts[len(agg.amounts)/2-1] + median) / 2
		}
		largest := agg.amounts[len(agg.amounts)-1]
		bucket.AverageTransaction = &average
		bucket.MedianTransaction = &median
		bucket.LargestTransaction = &largest
	}
	for mappingID, contribution := range agg.contributions {
		mapping := mappings[mappingID]
		bucket.Categories = append(bucket.Categories, GroupCategoryContributionDTO{
			Category: mapping.RawCategory, Total: contribution.total, TransactionCount: contribution.count,
		})
	}
	sort.Slice(bucket.Categories, func(i, j int) bool {
		if bucket.Categories[i].Total == bucket.Categories[j].Total {
			return bucket.Categories[i].Category < bucket.Categories[j].Category
		}
		return bucket.Categories[i].Total > bucket.Categories[j].Total
	})
	return bucket
}
