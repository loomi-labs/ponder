import { ADDRESS, SavingsV2ABI } from '@frankencoin/zchf';
import { ponder, type Context } from 'ponder:registry';
import {
	MintingHubV2MintingUpdateV2,
	MintingHubV2OwnerTransfersV2,
	MintingHubV2PositionV2,
	MintingHubV2Status,
	PositionAggregatesV2,
} from 'ponder:schema';
import { mainnet } from 'viem/chains';
import { and, eq, gt } from 'ponder';
import { normalizeAddress } from './utils/format';
import { resolvePositionOwner } from './utils/ownership';
/*
Events

PositionV2:MintingUpdate
PositionV2:PositionDenied
PositionV2:OwnershipTransferred
*/

ponder.on('PositionV2:MintingUpdate', async ({ event, context }) => {
	const { client } = context;
	const { PositionV2 } = context.contracts;

	const { collateral, price, minted } = event.args;
	const positionAddress = event.log.address;

	const position = await context.db.find(MintingHubV2PositionV2, {
		position: normalizeAddress(positionAddress),
	});

	if (!position) {
		console.error('PositionV2 not found in MintingUpdate event:', {
			positionAddress,
			collateral,
			price,
			minted,
			txHash: event.transaction.hash,
			blockNumber: event.block.number,
		});
		throw new Error('PositionV2 unknown in MintingUpdate');
	}

	// @dev: https://github.com/Frankencoin-ZCHF/ponder/issues/28
	let availableForClones = 0n;
	let availableForMinting = 0n;
	if (position.isOriginal) {
		availableForClones = await client.readContract({
			abi: PositionV2.abi,
			address: positionAddress,
			functionName: 'availableForClones',
		});
	} else {
		availableForMinting = await client.readContract({
			abi: PositionV2.abi,
			address: positionAddress,
			functionName: 'availableForMinting',
		});
	}

	const [cooldown, isClosed, baseRatePPM] = await Promise.all([
		client.readContract({ abi: PositionV2.abi, address: positionAddress, functionName: 'cooldown' }),
		client.readContract({ abi: PositionV2.abi, address: positionAddress, functionName: 'isClosed' }),
		client.readContract({ abi: SavingsV2ABI, address: ADDRESS[mainnet.id].savingsV2, functionName: 'currentRatePPM' }),
	]);

	await context.db.update(MintingHubV2PositionV2, { position: normalizeAddress(positionAddress) }).set({
		collateralBalance: collateral,
		price,
		minted,
		availableForMinting,
		availableForClones,
		cooldown: BigInt(cooldown),
		closed: isClosed,
	});

	const openPositions = await context.db.sql
		.select()
		.from(MintingHubV2PositionV2)
		.where(
			and(eq(MintingHubV2PositionV2.closed, false), eq(MintingHubV2PositionV2.denied, false), gt(MintingHubV2PositionV2.minted, 0n))
		);

	let totalMinted = 0n;
	let annualInterests = 0n;
	for (const p of openPositions) {
		totalMinted += p.minted;
		annualInterests += (p.minted * BigInt(p.riskPremiumPPM + Number(baseRatePPM))) / 1_000_000n;
	}

	await context.db
		.insert(PositionAggregatesV2)
		.values({ chainId: context.chain.id, totalMinted, annualInterests, updated: event.block.timestamp })
		.onConflictDoUpdate(() => ({ totalMinted, annualInterests, updated: event.block.timestamp }));

	const status = await context.db
		.insert(MintingHubV2Status)
		.values({
			position: normalizeAddress(positionAddress),
			ownerTransfersCounter: 0n,
			mintingUpdatesCounter: 1n,
			challengeStartedCounter: 0n,
			challengeAvertedBidsCounter: 0n,
			challengeSucceededBidsCounter: 0n,
		})
		.onConflictDoUpdate((current) => ({
			mintingUpdatesCounter: current.mintingUpdatesCounter + 1n,
		}));

	const annualInterestPPM = baseRatePPM + position.riskPremiumPPM;
	const isClone = normalizeAddress(position.original) !== normalizeAddress(position.position);

	const OneYear = 60 * 60 * 24 * 365;
	const feeTimeframe = Math.floor(parseInt(position.expiration.toString()) - parseInt(event.block.timestamp.toString()));
	const feePPM = BigInt(Math.floor((feeTimeframe * annualInterestPPM) / OneYear));
	const getFeePaid = (amount: bigint): bigint => (feePPM * amount) / 1_000_000n;

	const resolvedOwner = await resolvePositionOwner(
		normalizeAddress(position.owner),
		normalizeAddress(positionAddress),
		event.transaction.hash,
		client
	);

	const sharedFields = {
		txHash: event.transaction.hash,
		created: event.block.timestamp,
		position: normalizeAddress(position.position),
		owner: resolvedOwner,
		isClone,
		collateral: normalizeAddress(position.collateral),
		collateralName: position.collateralName,
		collateralSymbol: position.collateralSymbol,
		collateralDecimals: position.collateralDecimals,
		size: collateral,
		price,
		minted,
		annualInterestPPM,
		basePremiumPPM: baseRatePPM,
		riskPremiumPPM: position.riskPremiumPPM,
		reserveContribution: position.reserveContribution,
		feeTimeframe,
		feePPM: parseInt(feePPM.toString()),
	};

	if (status.mintingUpdatesCounter === 1n) {
		await context.db.insert(MintingHubV2MintingUpdateV2).values({
			count: 1n,
			...sharedFields,
			sizeAdjusted: collateral,
			priceAdjusted: price,
			mintedAdjusted: minted,
			feePaid: getFeePaid(minted),
		});
	} else {
		const prev = await context.db.find(MintingHubV2MintingUpdateV2, {
			position: normalizeAddress(position.position),
			count: status.mintingUpdatesCounter - 1n,
		});
		if (prev == null) throw new Error(`previous minting update not found.`);

		const sizeAdjusted = collateral - prev.size;
		const priceAdjusted = price - prev.price;
		const mintedAdjusted = minted - prev.minted;

		await context.db.insert(MintingHubV2MintingUpdateV2).values({
			count: status.mintingUpdatesCounter,
			...sharedFields,
			sizeAdjusted,
			priceAdjusted,
			mintedAdjusted,
			feePaid: mintedAdjusted > 0n ? getFeePaid(mintedAdjusted) : 0n,
		});
	}
});

ponder.on('PositionV2:PositionDenied', async ({ event, context }) => {
	const { client } = context;

	const [position, cooldown] = await Promise.all([
		context.db.find(MintingHubV2PositionV2, { position: normalizeAddress(event.log.address) }),
		client.readContract({ abi: context.contracts.PositionV2.abi, address: event.log.address, functionName: 'cooldown' }),
	]);

	if (position) {
		await context.db
			.update(MintingHubV2PositionV2, { position: normalizeAddress(event.log.address) })
			.set({ cooldown: BigInt(cooldown), denied: true, denyDate: event.block.timestamp });
	}
});

ponder.on('PositionV2:OwnershipTransferred', async ({ event, context }) => {
	const [status, position] = await Promise.all([
		context.db
			.insert(MintingHubV2Status)
			.values({
				position: normalizeAddress(event.log.address),
				ownerTransfersCounter: 1n,
				mintingUpdatesCounter: 0n,
				challengeStartedCounter: 0n,
				challengeAvertedBidsCounter: 0n,
				challengeSucceededBidsCounter: 0n,
			})
			.onConflictDoUpdate((current) => ({
				ownerTransfersCounter: current.ownerTransfersCounter + 1n,
			})),
		context.db.find(MintingHubV2PositionV2, { position: normalizeAddress(event.log.address) }),
	]);

	await context.db
		.insert(MintingHubV2OwnerTransfersV2)
		.values({
			version: 2,
			position: normalizeAddress(event.log.address),
			count: status.ownerTransfersCounter,
			created: event.block.timestamp,
			previousOwner: normalizeAddress(event.args.previousOwner),
			newOwner: normalizeAddress(event.args.newOwner),
			txHash: event.transaction.hash,
		})
		.onConflictDoNothing();

	if (position) {
		await context.db
			.update(MintingHubV2PositionV2, { position: normalizeAddress(event.log.address) })
			.set({ owner: normalizeAddress(event.args.newOwner) });
	}
});
