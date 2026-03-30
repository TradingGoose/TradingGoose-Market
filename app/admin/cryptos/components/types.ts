export type CryptoContract = {
  chainId: string
  chainCode: string | null
  chainName: string | null
  address: string
  contractType: string
}

export type CryptoRow = {
  id: string
  code: string
  name: string
  assetType: string | null
  active?: boolean
  contractAddresses: CryptoContract[]
  iconUrl: string | null
  updatedAt: string | null
}
