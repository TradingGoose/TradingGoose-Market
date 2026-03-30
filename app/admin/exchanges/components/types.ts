export type ExchangeRow = {
  id: string
  mic: string
  name: string | null
  lei: string | null
  url: string | null
  expiredAt: string | null
  createdAt: string | null
  active: boolean
  isSegment: boolean
  parentId: string | null
  countryId: string | null
  countryCode: string | null
  countryName: string | null
  cityId: string | null
  cityName: string | null
  updatedAt: string | null
}

export type ExchangeOption = {
  id: string
  mic: string
  name: string | null
}

export type CountryOption = {
  id: string
  code: string
  name: string
}

export type CityOption = {
  id: string
  name: string
  countryId: string
}
