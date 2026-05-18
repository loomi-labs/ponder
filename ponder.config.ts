import { createConfig, mergeAbis } from 'ponder';
import { arbitrum, avalanche, base, gnosis, mainnet, optimism, polygon, sonic } from 'viem/chains';
import { createPublicClient, erc20Abi, http } from 'viem';
import {
	ADDRESS,
	CCIPAdminABI,
	EquityABI,
	FrankencoinABI,
	MintingHubV1ABI,
	MintingHubV2ABI,
	PositionRollerV2ABI,
	PositionV1ABI,
	PositionV2ABI,
	UniswapV3PoolABI,
	LeadrateV2ABI,
	SavingsABI,
	SavingsV2ABI,
	BridgeAccountingABI,
	TransferReferenceABI,
	CrossChainReferenceABI,
} from '@frankencoin/zchf';

export const addr = ADDRESS;

export const config = {
	// core deployment
	[mainnet.id]: {
		rpc: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~12s blocks
		startFrankencoin: 18451518,
		startMintingHubV1: 18451536,
		startMintingHubV2: 21280757,
		startTransferReference: 22678761,
		startSavingsReferal: 22536327,
		startCCIP: 22623055,
		startUniswapPoolV3: 19122801,
	},

	// multichain support
	[polygon.id]: {
		rpc: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
		startBridgedFrankencoin: 72384538,
		startSavingsReferal: 72993144,
	},
	[arbitrum.id]: {
		rpc: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 10000, // ~250ms blocks — batch more to reduce request count
		startBridgedFrankencoin: 343470012,
		startSavingsReferal: 349273896,
	},
	[optimism.id]: {
		rpc: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
		startBridgedFrankencoin: 136678320,
		startSavingsReferal: 137404676,
	},
	[base.id]: {
		rpc: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
		startBridgedFrankencoin: 31080190,
		startSavingsReferal: 31809565,
	},
	[avalanche.id]: {
		rpc: `https://avax-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
		startBridgedFrankencoin: 63337938,
		startSavingsReferal: 64919925,
	},
	[gnosis.id]: {
		rpc: `https://gnosis-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~5s blocks
		startBridgedFrankencoin: 40394536,
		startSavingsReferal: 40678291,
	},
	[sonic.id]: {
		rpc: `https://sonic-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~500ms blocks
		startBridgedFrankencoin: 31589491,
		startSavingsReferal: 34961851,
	},
};

export const mainnetClient = createPublicClient({
	chain: mainnet,
	transport: http(config[mainnet.id].rpc),
});

const openPositionEventV1 = MintingHubV1ABI.find((a) => a.type === 'event' && a.name === 'PositionOpened');
if (openPositionEventV1 === undefined) throw new Error('openPositionEventV1 not found.');

const openPositionEventV2 = MintingHubV2ABI.find((a) => a.type === 'event' && a.name === 'PositionOpened');
if (openPositionEventV2 === undefined) throw new Error('openPositionEventV2 not found.');

export default createConfig({
	chains: {
		// ### NATIVE CHAIN SUPPORT ###
		[mainnet.name]: {
			id: mainnet.id,
			maxRequestsPerSecond: config[mainnet.id].maxRequestsPerSecond,
			pollingInterval: config[mainnet.id].pollingInterval,
			ethGetLogsBlockRange: config[mainnet.id].ethGetLogsBlockRange,
			rpc: http(config[mainnet.id].rpc),
		},

		// ### MULTI CHAIN SUPPORT ###
		[polygon.name]: {
			id: polygon.id,
			maxRequestsPerSecond: config[polygon.id].maxRequestsPerSecond,
			pollingInterval: config[polygon.id].pollingInterval,
			ethGetLogsBlockRange: config[polygon.id].ethGetLogsBlockRange,
			rpc: http(config[polygon.id].rpc),
		},
		[arbitrum.name]: {
			id: arbitrum.id,
			maxRequestsPerSecond: config[arbitrum.id].maxRequestsPerSecond,
			pollingInterval: config[arbitrum.id].pollingInterval,
			ethGetLogsBlockRange: config[arbitrum.id].ethGetLogsBlockRange,
			rpc: http(config[arbitrum.id].rpc),
		},
		[optimism.name]: {
			id: optimism.id,
			maxRequestsPerSecond: config[optimism.id].maxRequestsPerSecond,
			pollingInterval: config[optimism.id].pollingInterval,
			ethGetLogsBlockRange: config[optimism.id].ethGetLogsBlockRange,
			rpc: http(config[optimism.id].rpc),
		},
		[base.name]: {
			id: base.id,
			maxRequestsPerSecond: config[base.id].maxRequestsPerSecond,
			pollingInterval: config[base.id].pollingInterval,
			ethGetLogsBlockRange: config[base.id].ethGetLogsBlockRange,
			rpc: http(config[base.id].rpc),
		},
		[avalanche.name]: {
			id: avalanche.id,
			maxRequestsPerSecond: config[avalanche.id].maxRequestsPerSecond,
			pollingInterval: config[avalanche.id].pollingInterval,
			ethGetLogsBlockRange: config[avalanche.id].ethGetLogsBlockRange,
			rpc: http(config[avalanche.id].rpc),
		},
		[gnosis.name]: {
			id: gnosis.id,
			maxRequestsPerSecond: config[gnosis.id].maxRequestsPerSecond,
			pollingInterval: config[gnosis.id].pollingInterval,
			ethGetLogsBlockRange: config[gnosis.id].ethGetLogsBlockRange,
			rpc: http(config[gnosis.id].rpc),
		},
		[sonic.name]: {
			id: sonic.id,
			maxRequestsPerSecond: config[sonic.id].maxRequestsPerSecond,
			pollingInterval: config[sonic.id].pollingInterval,
			ethGetLogsBlockRange: config[sonic.id].ethGetLogsBlockRange,
			rpc: http(config[sonic.id].rpc),
		},
	},
	contracts: {
		// ### NATIVE CONTRACT ###
		Frankencoin: {
			// Core
			abi: FrankencoinABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].frankencoin,
					startBlock: config[mainnet.id].startFrankencoin,
				},
				[polygon.name]: {
					address: addr[polygon.id].ccipBridgedFrankencoin,
					startBlock: config[polygon.id].startBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].ccipBridgedFrankencoin,
					startBlock: config[arbitrum.id].startBridgedFrankencoin,
				},
				[optimism.name]: {
					address: addr[optimism.id].ccipBridgedFrankencoin,
					startBlock: config[optimism.id].startBridgedFrankencoin,
				},
				[base.name]: {
					address: addr[base.id].ccipBridgedFrankencoin,
					startBlock: config[base.id].startBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].ccipBridgedFrankencoin,
					startBlock: config[avalanche.id].startBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].ccipBridgedFrankencoin,
					startBlock: config[gnosis.id].startBridgedFrankencoin,
				},
				[sonic.name]: {
					address: addr[sonic.id].ccipBridgedFrankencoin,
					startBlock: config[sonic.id].startBridgedFrankencoin,
				},
			},
		},
		Equity: {
			// Core
			chain: mainnet.name,
			abi: EquityABI,
			address: addr[mainnet.id].equity,
			startBlock: config[mainnet.id].startFrankencoin,
		},
		MintingHubV1: {
			// V1
			chain: mainnet.name,
			abi: MintingHubV1ABI,
			address: addr[mainnet.id].mintingHubV1,
			startBlock: config[mainnet.id].startMintingHubV1,
		},
		PositionV1: {
			// V1
			chain: mainnet.name,
			abi: PositionV1ABI,
			address: {
				address: addr[mainnet.id].mintingHubV1,
				event: openPositionEventV1,
				parameter: 'position',
			},
			startBlock: config[mainnet.id].startMintingHubV1,
		},
		MintingHubV2: {
			// V2
			chain: mainnet.name,
			abi: MintingHubV2ABI,
			address: addr[mainnet.id].mintingHubV2,
			startBlock: config[mainnet.id].startMintingHubV2,
		},
		PositionV2: {
			// V2
			chain: mainnet.name,
			abi: PositionV2ABI,
			address: {
				address: addr[mainnet.id].mintingHubV2,
				event: openPositionEventV2,
				parameter: 'position',
			},
			startBlock: config[mainnet.id].startMintingHubV2,
		},
		SavingsV2: {
			// V2
			chain: mainnet.name,
			abi: SavingsV2ABI,
			address: addr[mainnet.id].savingsV2,
			startBlock: config[mainnet.id].startMintingHubV2,
		},
		RollerV2: {
			// V2
			chain: mainnet.name,
			abi: PositionRollerV2ABI,
			address: addr[mainnet.id].rollerV2,
			startBlock: config[mainnet.id].startMintingHubV2,
		},
		Leadrate: {
			// incl. SavingsV2, SavingsReferral, BridgedSavingsReferal
			abi: LeadrateV2ABI,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].savingsV2, addr[mainnet.id].savingsReferral],
					startBlock: config[mainnet.id].startMintingHubV2,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedSavings],
					startBlock: config[polygon.id].startBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedSavings],
					startBlock: config[arbitrum.id].startBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedSavings],
					startBlock: config[optimism.id].startBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedSavings],
					startBlock: config[base.id].startBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedSavings],
					startBlock: config[avalanche.id].startBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedSavings],
					startBlock: config[gnosis.id].startBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedSavings],
					startBlock: config[sonic.id].startBridgedFrankencoin,
				},
			},
		},
		SavingsReferral: {
			// incl. SavingsReferral, BridgedSavingsReferral
			abi: SavingsABI,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].savingsReferral],
					startBlock: config[mainnet.id].startSavingsReferal,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedSavings],
					startBlock: config[polygon.id].startSavingsReferal,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedSavings],
					startBlock: config[arbitrum.id].startSavingsReferal,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedSavings],
					startBlock: config[optimism.id].startSavingsReferal,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedSavings],
					startBlock: config[base.id].startSavingsReferal,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedSavings],
					startBlock: config[avalanche.id].startSavingsReferal,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedSavings],
					startBlock: config[gnosis.id].startSavingsReferal,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedSavings],
					startBlock: config[sonic.id].startSavingsReferal,
				},
			},
		},
		// ### COMMON CONTRACTS ###
		UniswapV3Pool: {
			chain: mainnet.name,
			abi: UniswapV3PoolABI,
			address: addr[mainnet.id].uniswapPoolV3ZCHFUSDT,
			startBlock: config[mainnet.id].startUniswapPoolV3,
		},

		ERC20: {
			abi: erc20Abi,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].frankencoin, addr[mainnet.id].equity],
					startBlock: config[mainnet.id].startFrankencoin,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedFrankencoin],
					startBlock: config[polygon.id].startBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedFrankencoin],
					startBlock: config[arbitrum.id].startBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedFrankencoin],
					startBlock: config[optimism.id].startBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedFrankencoin],
					startBlock: config[base.id].startBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedFrankencoin],
					startBlock: config[avalanche.id].startBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedFrankencoin],
					startBlock: config[gnosis.id].startBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedFrankencoin],
					startBlock: config[sonic.id].startBridgedFrankencoin,
				},
			},
		},

		// ### CROSS CHAIN SUPPORT ###

		CCIPAdmin: {
			abi: CCIPAdminABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].ccipAdmin,
					startBlock: config[mainnet.id].startCCIP,
				},
				[polygon.name]: {
					address: addr[polygon.id].ccipAdmin,
					startBlock: config[polygon.id].startBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].ccipAdmin,
					startBlock: config[arbitrum.id].startBridgedFrankencoin,
				},
				[optimism.name]: {
					address: addr[optimism.id].ccipAdmin,
					startBlock: config[optimism.id].startBridgedFrankencoin,
				},
				[base.name]: {
					address: addr[base.id].ccipAdmin,
					startBlock: config[base.id].startBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].ccipAdmin,
					startBlock: config[avalanche.id].startBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].ccipAdmin,
					startBlock: config[gnosis.id].startBridgedFrankencoin,
				},
				[sonic.name]: {
					address: addr[sonic.id].ccipAdmin,
					startBlock: config[sonic.id].startBridgedFrankencoin,
				},
			},
		},

		CCIPBridgedAccounting: {
			abi: BridgeAccountingABI,
			chain: mainnet.name,
			address: addr[mainnet.id].ccipBridgeAccounting,
			startBlock: config[mainnet.id].startCCIP,
		},

		TransferReference: {
			abi: mergeAbis([TransferReferenceABI, CrossChainReferenceABI]),
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].transferReference],
					startBlock: config[mainnet.id].startTransferReference,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedFrankencoin],
					startBlock: config[polygon.id].startBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedFrankencoin],
					startBlock: config[arbitrum.id].startBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedFrankencoin],
					startBlock: config[optimism.id].startBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedFrankencoin],
					startBlock: config[base.id].startBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedFrankencoin],
					startBlock: config[avalanche.id].startBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedFrankencoin],
					startBlock: config[gnosis.id].startBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedFrankencoin],
					startBlock: config[sonic.id].startBridgedFrankencoin,
				},
			},
		},
	},
});
