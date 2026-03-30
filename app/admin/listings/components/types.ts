export type SecondaryExchDetail = {
  id: string
  mic: string | null
  name: string | null
}

export type ListingRow = {
  id: string
  base: string
  quote: string | null
  quoteName: string | null
  name: string | null
  iconUrl: string | null
  marketId: string | null
  marketCode: string | null
  marketName: string | null
  primaryExchId: string | null
  primaryMicCode: string | null
  countryId: string | null
  countryCode: string | null
  countryName: string | null
  secondaryExchIds: string[]
  secondaryExchDetails: SecondaryExchDetail[]
  assetClass: string
  active: boolean
}

export type MicOption = {
  id: string
  mic: string
  name: string | null
}

export type CountryOption = {
  id: string
  code: string
  name: string
}
