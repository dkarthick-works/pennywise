import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { budgetKeys, getMonthlyBudget, putMonthlyBudget } from "../api/ledger";
import type { Budgets } from "../types";

export function useMonthlyBudgetQuery(month: string, enabled = true) {
  return useQuery({
    queryKey: budgetKeys.month(month),
    queryFn: () => getMonthlyBudget(month),
    enabled,
  });
}

export function useSaveMonthlyBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, budgets }: { month: string; budgets: Budgets }) =>
      putMonthlyBudget(month, budgets),
    onSuccess: (data, variables) => {
      qc.setQueryData(budgetKeys.month(variables.month), data);
      void qc.invalidateQueries({ queryKey: budgetKeys.month(variables.month) });
      void qc.invalidateQueries({ queryKey: ["dashboard", "monthly", variables.month] });
    },
  });
}

export function budgetsFromMonthly(data: { essential: number; flexible: number; daily: number }): Budgets {
  return { essential: data.essential, flexible: data.flexible, daily: data.daily };
}
