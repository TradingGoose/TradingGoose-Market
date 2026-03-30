export type MarketHourRow = {
  id: string
  countryId: string | null
  countryCode: string | null
  countryName: string | null
  cityId: string | null
  cityName: string | null
  marketId: string | null
  marketCode: string | null
  marketName: string | null
  assetClass: string | null
  listingId: string | null
  listingBase: string | null
  timeZoneId: string
  timeZoneName: string | null
  timeZoneOffset: string | null
  timeZoneOffsetDst?: string | null
  sessionsCount: number
  holidaysCount: number
  updatedAt: string | null
  hours?: any
}
