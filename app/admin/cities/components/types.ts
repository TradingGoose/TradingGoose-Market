export type CityRow = {
  id: string
  name: string
  countryId: string
  countryCode: string | null
  countryName: string | null
  timeZoneId: string | null
  timeZoneName: string | null
  timeZoneOffset: string | null
  timeZoneOffsetDst?: string | null
  timeZoneObservesDst?: boolean | null
  updatedAt: string | null
}

export type CountryOption = {
  id: string
  code: string
  name: string
}

export type TimeZoneOption = {
  id: string
  name: string
  offset: string
  offsetDst?: string | null
  observesDst?: boolean
}
