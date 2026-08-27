export interface QuotaWindow { percentage: number; remainingFraction: number; label: string; resetInText?: string; rawText: string }
export interface QuotaGroup { groupName: string; models: string[]; weekly: QuotaWindow; fiveHour: QuotaWindow }
export interface AntigravityUsageReport { account?: string; quotaGroups: QuotaGroup[]; fetchedAt: Date }
export interface IQuotaProvider<TReport> { fetch(): Promise<TReport> }
