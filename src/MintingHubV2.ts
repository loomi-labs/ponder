import { ADDRESS, ERC20ABI, SavingsV2ABI } from '@frankencoin/zchf';
import { ponder } from 'ponder:registry';
import {
	CommonEcosystem,
	MintingHubV2ChallengeBidV2,
	MintingHubV2ChallengeV2,
	MintingHubV2MintingUpdateV2,
	MintingHubV2OwnerTransfersV2,
	MintingHubV2PositionV2,
	MintingHubV2Status,
} from 'ponder:schema';
import { decodeAbiParameters } from 'viem';
import { mainnet } from 'viem/chains';
import { normalizeAddress } from './utils/format';
import { MINTING_UPDATE_TOPIC_V2, OWNERSHIP_TRANSFERRED_TOPIC, resolvePositionOwner } from './utils/ownership';

/*
Events

MintingHubV2:PositionOpened
MintingHubV2:ChallengeStarted
MintingHubV2:ChallengeAverted
MintingHubV2:ChallengeSucceeded
*/

// event PositionOpened(address indexed owner, address indexed position, address original, address collateral);
ponder.on('MintingHubV2:PositionOpened', async ({ event, context }) => {
	const { client } = context;
	const { PositionV2 } = context.contracts;

	// ------------------------------------------------------------------
	// FROM EVENT & TRANSACTION
	const { owner, position, collateral } = event.args;
	const parent = event.args.original;

	const created: bigint = event.block.timestamp;

	const isOriginal: boolean = normalizeAddress(parent) === normalizeAddress(position);
	const isClone: boolean = !isOriginal;
	const closed: boolean = false;
	const denied: boolean = false;

	// ------------------------------------------------------------------
	// CONST + COLLATERAL ERC20 + CHANGEABLE (all independent, fetch in parallel)
	// zchf address must be read first since it's needed for zchf ERC20 reads
	const [
		original,
		zchf,
		minimumCollateral,
		riskPremiumPPM,
		reserveContribution,
		start,
		expiration,
		challengePeriod,
		limitForClones,
		collateralName,
		collateralSymbol,
		collateralDecimals,
		collateralBalance,
		price,
		availableForClones,
		availableForMinting,
		minted,
		cooldown,
	] = await Promise.all([
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'original' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'zchf' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'minimumCollateral' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'riskPremiumPPM' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'reserveContribution' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'start' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'expiration' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'challengePeriod' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'limit' }),
		client.readContract({ abi: ERC20ABI, address: collateral, functionName: 'name' }),
		client.readContract({ abi: ERC20ABI, address: collateral, functionName: 'symbol' }),
		client.readContract({ abi: ERC20ABI, address: collateral, functionName: 'decimals' }),
		client.readContract({ abi: ERC20ABI, address: collateral, functionName: 'balanceOf', args: [position] }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'price' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'availableForClones' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'availableForMinting' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'minted' }),
		client.readContract({ abi: PositionV2.abi, address: position, functionName: 'cooldown' }),
	]);

	// ------------------------------------------------------------------
	// ZCHF ERC20 (requires zchf address from above)
	const [zchfName, zchfSymbol, zchfDecimals] = await Promise.all([
		client.readContract({ abi: ERC20ABI, address: zchf, functionName: 'name' }),
		client.readContract({ abi: ERC20ABI, address: zchf, functionName: 'symbol' }),
		client.readContract({ abi: ERC20ABI, address: zchf, functionName: 'decimals' }),
	]);

	// ------------------------------------------------------------------
	// CALC VALUES
	// const priceAdjusted = price / BigInt(10 ** (36 - collateralDecimals));
	const limitForPosition = (collateralBalance * price) / BigInt(10 ** zchfDecimals);
	const availableForPosition = limitForPosition - minted;

	// ------------------------------------------------------------------
	// ------------------------------------------------------------------
	// ------------------------------------------------------------------
	// If clone, update original position
	if (isClone) {
		const [originalAvailableForClones, originalAvailableForMinting] = await Promise.all([
			client.readContract({ abi: PositionV2.abi, address: original, functionName: 'availableForClones' }),
			client.readContract({ abi: PositionV2.abi, address: original, functionName: 'availableForMinting' }),
		]);

		await context.db.update(MintingHubV2PositionV2, { position: normalizeAddress(original) }).set({
			availableForClones: originalAvailableForClones,
			availableForMinting: originalAvailableForMinting,
		});
	}

	// ------------------------------------------------------------------
	// ------------------------------------------------------------------
	// ------------------------------------------------------------------
	// Create position entry for DB
	// When a position is opened via CloneHelper, event.args.owner is still the
	// CloneHelper address. Resolve to the actual beneficiary before storing.
	const resolvedOwner = await resolvePositionOwner(normalizeAddress(owner), normalizeAddress(position), event.transaction.hash, client);

	await context.db.insert(MintingHubV2PositionV2).values({
		position: normalizeAddress(position),
		owner: resolvedOwner,
		zchf,
		collateral,
		price,

		created,
		isOriginal,
		isClone,
		denied,
		denyDate: 0n,
		closed,
		original,
		parent,

		minimumCollateral,
		riskPremiumPPM,
		reserveContribution,
		start: BigInt(start),
		cooldown: BigInt(cooldown),
		expiration: BigInt(expiration),
		challengePeriod: BigInt(challengePeriod),

		zchfName,
		zchfSymbol,
		zchfDecimals,

		collateralName,
		collateralSymbol,
		collateralDecimals,
		collateralBalance,

		limitForClones,
		availableForClones,
		availableForMinting,
		minted,
	});

	// ------------------------------------------------------------------
	// COMMON

	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'MintingHubV2:TotalPositions',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await context.db
		.insert(MintingHubV2Status)
		.values({
			position: normalizeAddress(event.args.position),
			ownerTransfersCounter: 0n,
			mintingUpdatesCounter: 0n,
			challengeStartedCounter: 0n,
			challengeAvertedBidsCounter: 0n,
			challengeSucceededBidsCounter: 0n,
		})
		.onConflictDoNothing();
});

ponder.on('MintingHubV2:ChallengeStarted', async ({ event, context }) => {
	const { client } = context;
	const { MintingHubV2, PositionV2 } = context.contracts;

	const [challenges, period, liqPrice] = await Promise.all([
		client.readContract({
			abi: MintingHubV2.abi,
			address: MintingHubV2.address,
			functionName: 'challenges',
			args: [event.args.number],
		}),
		client.readContract({ abi: PositionV2.abi, address: event.args.position, functionName: 'challengePeriod' }),
		client.readContract({ abi: PositionV2.abi, address: event.args.position, functionName: 'price' }),
	]);

	await context.db.insert(MintingHubV2ChallengeV2).values({
		position: normalizeAddress(event.args.position),
		number: event.args.number,
		txHash: event.transaction.hash,

		challenger: event.args.challenger,
		start: BigInt(challenges[1]),
		created: event.block.timestamp,
		duration: BigInt(period),
		size: event.args.size,
		liqPrice,

		bids: 0n,
		filledSize: 0n,
		acquiredCollateral: 0n,
		status: 'Active',
	});

	// ------------------------------------------------------------------
	// COMMON
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'MintingHubV2:TotalChallenges',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await context.db
		.insert(MintingHubV2Status)
		.values({
			position: normalizeAddress(event.args.position),
			ownerTransfersCounter: 0n,
			mintingUpdatesCounter: 0n,
			challengeStartedCounter: 1n,
			challengeAvertedBidsCounter: 0n,
			challengeSucceededBidsCounter: 0n,
		})
		.onConflictDoUpdate((current) => ({
			challengeStartedCounter: current.challengeStartedCounter + 1n,
		}));
});

// event ChallengeAverted(address indexed position, uint256 number, uint256 size);
ponder.on('MintingHubV2:ChallengeAverted', async ({ event, context }) => {
	const { client } = context;
	const { MintingHubV2, PositionV2 } = context.contracts;

	const [challenges, cooldown, liqPrice, challenge] = await Promise.all([
		client.readContract({
			abi: MintingHubV2.abi,
			address: MintingHubV2.address,
			functionName: 'challenges',
			args: [event.args.number],
		}),
		client.readContract({ abi: PositionV2.abi, address: event.args.position, functionName: 'cooldown' }),
		client.readContract({ abi: PositionV2.abi, address: event.args.position, functionName: 'price' }),
		context.db.find(MintingHubV2ChallengeV2, { position: normalizeAddress(event.args.position), number: event.args.number }),
	]);

	if (!challenge) {
		console.error('ChallengeV2 not found in ChallengeAverted event:', {
			position: event.args.position,
			number: event.args.number,
			size: event.args.size,
			txHash: event.transaction.hash,
			blockNumber: event.block.number,
		});
		throw new Error('ChallengeV2 not found');
	}

	// Keep as bigint throughout calculations to preserve precision
	const _amount = (liqPrice * event.args.size) / BigInt(10 ** 18);

	// create ChallengeBidV2 entry
	await context.db.insert(MintingHubV2ChallengeBidV2).values({
		position: normalizeAddress(event.args.position),
		number: event.args.number,
		numberBid: challenge.bids,
		txHash: event.transaction.hash,
		bidder: event.transaction.from,
		created: event.block.timestamp,
		bidType: 'Averted',
		bid: _amount,
		price: liqPrice,
		filledSize: event.args.size,
		acquiredCollateral: 0n,
		challengeSize: challenge.size,
	});

	// update ChallengeV2 related changes
	await context.db
		.update(MintingHubV2ChallengeV2, { position: normalizeAddress(event.args.position), number: event.args.number })
		.set((current) => ({
			bids: current.bids + 1n,
			filledSize: current.filledSize + event.args.size,
			status: challenges[3] === 0n ? 'Success' : current.status,
		}));

	// update PositionV2 related changes
	await context.db
		.update(MintingHubV2PositionV2, { position: normalizeAddress(event.args.position) })
		.set({ cooldown: BigInt(cooldown) });

	// ------------------------------------------------------------------
	// COMMON
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'MintingHubV2:TotalAvertedBids',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await context.db.update(MintingHubV2Status, { position: normalizeAddress(event.args.position) }).set((current) => ({
		challengeAvertedBidsCounter: current.challengeAvertedBidsCounter + 1n,
	}));
});

ponder.on('MintingHubV2:ChallengeSucceeded', async ({ event, context }) => {
	const { client } = context;
	const { MintingHubV2, PositionV2 } = context.contracts;

	const [challenges, cooldown, challenge] = await Promise.all([
		client.readContract({
			abi: MintingHubV2.abi,
			address: MintingHubV2.address,
			functionName: 'challenges',
			args: [event.args.number],
		}),
		client.readContract({ abi: PositionV2.abi, address: event.args.position, functionName: 'cooldown' }),
		context.db.find(MintingHubV2ChallengeV2, { position: normalizeAddress(event.args.position), number: event.args.number }),
	]);

	if (!challenge) {
		console.error('ChallengeV2 not found in ChallengeSucceeded event:', {
			position: event.args.position,
			number: event.args.number,
			bid: event.args.bid,
			challengeSize: event.args.challengeSize,
			acquiredCollateral: event.args.acquiredCollateral,
			txHash: event.transaction.hash,
			blockNumber: event.block.number,
		});
		throw new Error('ChallengeV2 not found');
	}

	// Keep as bigint throughout calculations to preserve precision
	const _price = (event.args.bid * BigInt(10 ** 18)) / event.args.challengeSize;

	// create ChallengeBidV2 entry
	await context.db.insert(MintingHubV2ChallengeBidV2).values({
		position: normalizeAddress(event.args.position),
		number: event.args.number,
		numberBid: challenge.bids,
		txHash: event.transaction.hash,
		bidder: event.transaction.from,
		created: event.block.timestamp,
		bidType: 'Succeeded',
		bid: event.args.bid,
		price: _price,
		filledSize: event.args.challengeSize,
		acquiredCollateral: event.args.acquiredCollateral,
		challengeSize: challenge.size,
	});

	// update ChallengeV2 related changes
	await context.db
		.update(MintingHubV2ChallengeV2, { position: normalizeAddress(event.args.position), number: event.args.number })
		.set((current) => ({
			bids: current.bids + 1n,
			acquiredCollateral: current.acquiredCollateral + event.args.acquiredCollateral,
			filledSize: current.filledSize + event.args.challengeSize,
			status: challenges[3] === 0n ? 'Success' : current.status,
		}));

	// update PositionV2 related changes
	await context.db
		.update(MintingHubV2PositionV2, { position: normalizeAddress(event.args.position) })
		.set({ cooldown: BigInt(cooldown) });

	// ------------------------------------------------------------------
	// COMMON
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'MintingHubV2:TotalSucceededBids',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await context.db.update(MintingHubV2Status, { position: normalizeAddress(event.args.position) }).set((current) => ({
		challengeSucceededBidsCounter: current.challengeSucceededBidsCounter + 1n,
	}));
});
