export type MarketRow = {
  id: string
  code: string
  name: string
  url: string | null
  countryId: string | null
  countryCode: string | null
  countryName: string | null
  cityId: string | null
  cityName: string | null
  timeZoneId: string | null
  timeZoneName: string | null
  timeZoneOffset: string | null
  timeZoneOffsetDst?: string | null
}

export type CountryOption = {
  id: string
  code: string
  name: string
}

export type CityOption = {
  id: string
  name: string
  countryId?: string
}

export type TimeZoneOption = {
  id: string
  name: string
  offset: string
  offsetDst?: string | null
  observesDst?: boolean
}
