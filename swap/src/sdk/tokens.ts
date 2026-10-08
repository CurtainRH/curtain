/**
 * Tokens Curtain supports on Robinhood Chain mainnet (4663). Addresses verified
 * against docs.robinhood.com/chain/contracts and Robinhood's asset registry
 * (api.robinhood.com/rhj/assets) with active on-chain Uniswap v3 liquidity.
 * Logos are served by the frontend from /public/tokens.
 */
import type { Address } from "viem";

export type TokenCategory =
  | "all"
  | "tech"
  | "etf"
  | "crypto"
  | "retail"
  | "bluechip";

export interface CurtainToken {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  logo: string;
  /** ERC-8056: balances are raw units; display = raw × uiMultiplier(). */
  stock: boolean;
  category: "tech" | "etf" | "crypto" | "retail" | "bluechip";
}

export const ROBINHOOD_CHAIN_TOKENS: CurtainToken[] = [
  { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, logo: "/tokens/usdg.png", stock: false, category: "crypto" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, logo: "/tokens/nvda.svg", stock: true, category: "tech" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, logo: "/tokens/aapl.svg", stock: true, category: "tech" },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, logo: "/tokens/msft.svg", stock: true, category: "tech" },
  { symbol: "GOOGL", name: "Alphabet Class A", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, logo: "/tokens/googl.svg", stock: true, category: "tech" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, logo: "/tokens/amzn.svg", stock: true, category: "tech" },
  { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, logo: "/tokens/meta.svg", stock: true, category: "tech" },
  { symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, logo: "/tokens/amd.svg", stock: true, category: "tech" },
  { symbol: "PLTR", name: "Palantir Technologies", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", decimals: 18, logo: "/tokens/pltr.svg", stock: true, category: "tech" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", decimals: 18, logo: "/tokens/tsm.svg", stock: true, category: "tech" },
  { symbol: "INTC", name: "Intel", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", decimals: 18, logo: "/tokens/intc.svg", stock: true, category: "tech" },
  { symbol: "DELL", name: "Dell", address: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", decimals: 18, logo: "/tokens/dell.png", stock: true, category: "tech" },
  { symbol: "SMCI", name: "Super Micro Computer", address: "0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a", decimals: 18, logo: "/tokens/smci.png", stock: true, category: "tech" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, logo: "/tokens/spy.svg", stock: true, category: "etf" },
  { symbol: "QQQ", name: "Invesco QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", decimals: 18, logo: "/tokens/qqq.svg", stock: true, category: "etf" },
  { symbol: "GLD", name: "SPDR Gold Trust", address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", decimals: 18, logo: "/tokens/gld.svg", stock: true, category: "etf" },
  { symbol: "SLV", name: "iShares Silver Trust", address: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", decimals: 18, logo: "/tokens/slv.svg", stock: true, category: "etf" },
  { symbol: "USO", name: "United States Oil Fund", address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", decimals: 18, logo: "/tokens/uso.png", stock: true, category: "etf" },
  { symbol: "SGOV", name: "iShares 0-3 Month Treasury Bond", address: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", decimals: 18, logo: "/tokens/sgov.png", stock: true, category: "etf" },
  { symbol: "VTI", name: "Vanguard Morningstar Total Stock Market ETF", address: "0x0594134DF3f171a354D9C85eBD65b7A6148F6D09", decimals: 18, logo: "/tokens/vti.svg", stock: true, category: "etf" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", address: "0x072f979c2CAc8e1391B0162a87Fee094bF8744a0", decimals: 18, logo: "/tokens/smh.png", stock: true, category: "etf" },
  { symbol: "XLK", name: "State Street Technology Select Sector SPDR ETF", address: "0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43", decimals: 18, logo: "/tokens/xlk.png", stock: true, category: "etf" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, logo: "/tokens/coin.svg", stock: true, category: "crypto" },
  { symbol: "MSTR", name: "Strategy Inc.", address: "0xec262a75e413fAfD0dF80480274532C79D42da09", decimals: 18, logo: "/tokens/mstr.svg", stock: true, category: "crypto" },
  { symbol: "CRCL", name: "Circle Internet Group", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", decimals: 18, logo: "/tokens/crcl.svg", stock: true, category: "crypto" },
  { symbol: "GLXY", name: "Galaxy Digital Inc.", address: "0x2D427692E928fa156ec22acfaBaFA0447C5805B7", decimals: 18, logo: "/tokens/glxy.svg", stock: true, category: "crypto" },
  { symbol: "SOFI", name: "SoFi Technologies", address: "0x98E75885157C80992A8D41b696D8c9C6Fb30A926", decimals: 18, logo: "/tokens/sofi.png", stock: true, category: "crypto" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, logo: "/tokens/tsla.svg", stock: true, category: "retail" },
  { symbol: "GME", name: "GameStop", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", decimals: 18, logo: "/tokens/gme.svg", stock: true, category: "retail" },
  { symbol: "AMC", name: "AMC Entertainment", address: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", decimals: 18, logo: "/tokens/amc.png", stock: true, category: "retail" },
  { symbol: "RDDT", name: "Reddit", address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C", decimals: 18, logo: "/tokens/rddt.png", stock: true, category: "retail" },
  { symbol: "DJT", name: "Trump Media & Technology Group", address: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516", decimals: 18, logo: "/tokens/djt.png", stock: true, category: "retail" },
  { symbol: "HIMS", name: "Hims & Hers Health", address: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", decimals: 18, logo: "/tokens/hims.png", stock: true, category: "retail" },
  { symbol: "SPCX", name: "Space Exploration Technologies Corp. Class A Common Stock", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", decimals: 18, logo: "/tokens/spcx.png", stock: true, category: "retail" },
  { symbol: "RBLX", name: "Roblox", address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8", decimals: 18, logo: "/tokens/rblx.svg", stock: true, category: "retail" },
  { symbol: "LLY", name: "Eli Lilly", address: "0x8005d266423c7ea827372c9c864491e5786600ea", decimals: 18, logo: "/tokens/lly.svg", stock: true, category: "bluechip" },
  { symbol: "COST", name: "Costco", address: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2", decimals: 18, logo: "/tokens/cost.png", stock: true, category: "bluechip" },
  { symbol: "NFLX", name: "Netflix", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", decimals: 18, logo: "/tokens/nflx.svg", stock: true, category: "bluechip" },
  { symbol: "SHOP", name: "Shopify", address: "0xF53F66751B1Eff985311b693531E3290F600c410", decimals: 18, logo: "/tokens/shop.png", stock: true, category: "bluechip" },
  { symbol: "BA", name: "Boeing", address: "0x4D21483a44Bf67a86b77E3dA301411880797D452", decimals: 18, logo: "/tokens/ba.png", stock: true, category: "bluechip" },
  { symbol: "F", name: "Ford Motor", address: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C", decimals: 18, logo: "/tokens/f.png", stock: true, category: "bluechip" },
  { symbol: "IBM", name: "IBM", address: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619", decimals: 18, logo: "/tokens/ibm.svg", stock: true, category: "bluechip" },
  { symbol: "JNJ", name: "Johnson & Johnson", address: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80", decimals: 18, logo: "/tokens/jnj.svg", stock: true, category: "bluechip" },
  { symbol: "PFE", name: "Pfizer", address: "0x7066A64c24e4206CD62E83bf198c1E7EB361F51e", decimals: 18, logo: "/tokens/pfe.svg", stock: true, category: "bluechip" },
  { symbol: "UPS", name: "UPS", address: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2", decimals: 18, logo: "/tokens/ups.png", stock: true, category: "bluechip" },
];

export const DEFAULT_TOKENS: Record<string, Address> = Object.fromEntries(
  ROBINHOOD_CHAIN_TOKENS.map((t) => [t.symbol, t.address])
);
