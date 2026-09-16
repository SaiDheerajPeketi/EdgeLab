export class ResultTradesLoadLease {
  begin(ownsLoading?: boolean): { loadingOwner: number | null; version: number };
  isCurrent(version: number): boolean;
  settle(version: number): boolean;
}
