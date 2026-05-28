import { ponder } from 'ponder:registry';
import {
	MintingHubV1MintingUpdateV1,
	MintingHubV1OwnerTransfersV1,
	MintingHubV1PositionV1,
	MintingHubV1Status,
	PositionAggregatesV1,
} from 'ponder:schema';
import { Address } from 'viem';
import { and, eq, gt } from 'ponder';
import { normalizeAddress } from './utils/format';

/*
Events

PositionV1:MintingUpdate
PositionV1:PositionDenied
PositionV1:OwnershipTransferred
*/

ponder.on('PositionV1:MintingUpdate', async ({ event, context }) => {
	const { client } = context;

	// event MintingUpdateV1(uint256 collateral, uint256 price, uint256 minted, uint256 limit);
	const { collateral, price, minted, limit } = event.args;
	const positionAddress = event.log.address;

	// position updates (all independent, fetch in parallel)
	const [availableForClones, cooldown, position] = await Promise.all([
		client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'limitForClones' }),
		client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'cooldown' }),
		context.db.find(MintingHubV1PositionV1, { position: normalizeAddress(positionAddress) }),
	]);

	if (position) {
		const limitForPosition = (collateral * price) / BigInt(10 ** position.zchfDecimals);
		const availableForPosition = limitForPosition - minted;

		await context.db
			.update(MintingHubV1PositionV1, {
				position: normalizeAddress(positionAddress),
			})
			.set({
				collateralBalance: collateral,
				price,
				minted,
				limitForPosition,
				limitForClones: limit,
				availableForPosition,
				availableForClones,
				cooldown,
				closed: collateral == 0n,
			});
	}

	// Recalculate V1 aggregates for this chain
	const openPositions = await context.db.sql
		.select()
		.from(MintingHubV1PositionV1)
		.where(
			and(eq(MintingHubV1PositionV1.closed, false), eq(MintingHubV1PositionV1.denied, false), gt(MintingHubV1PositionV1.minted, 0n))
		);

	let totalMinted = 0n;
	let annualInterests = 0n;
	for (let p of openPositions) {
		totalMinted += p.minted;
		annualInterests += (p.minted * BigInt(p.annualInterestPPM)) / 1_000_000n;
	}

	// Update aggregate table
	await context.db
		.insert(PositionAggregatesV1)
		.values({
			chainId: context.chain.id,
			totalMinted,
			annualInterests,
			updated: event.block.timestamp,
		})
		.onConflictDoUpdate(() => ({
			totalMinted,
			annualInterests,
			updated: event.block.timestamp,
		}));

	// update minting counter
	const status = await context.db
		.insert(MintingHubV1Status)
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

	let missingPositionData: {
		position: string;
		owner: string;
		original: string;
		expiration: bigint;
		annualInterestPPM: number;
		reserveContribution: number;
		collateral: string;
		collateralName: string;
		collateralSymbol: string;
		collateralDecimals: number;
	};

	// @dev: issue due to "wrong" event sequence within the smart contracts
	if (position === null) {
		const [owner, original, expiration, annualInterestPPM, reserveContribution, collateralAddress] = await Promise.all([
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'owner' }),
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'original' }),
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'expiration' }),
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'annualInterestPPM' }),
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'reserveContribution' }),
			client.readContract({ abi: context.contracts.PositionV1.abi, address: positionAddress, functionName: 'collateral' }),
		]);

		const [collateralName, collateralSymbol, collateralDecimals] = await Promise.all([
			client.readContract({ abi: context.contracts.ERC20.abi, address: collateralAddress, functionName: 'name' }),
			client.readContract({ abi: context.contracts.ERC20.abi, address: collateralAddress, functionName: 'symbol' }),
			client.readContract({ abi: context.contracts.ERC20.abi, address: collateralAddress, functionName: 'decimals' }),
		]);

		missingPositionData = {
			position: positionAddress,
			owner,
			original,
			expiration,
			annualInterestPPM,
			reserveContribution,
			collateral: collateralAddress,
			collateralName,
			collateralSymbol,
			collateralDecimals,
		};
	} else {
		missingPositionData = {
			position: position.position,
			owner: position.owner,
			original: position.original,
			expiration: position.expiration,
			annualInterestPPM: position.annualInterestPPM,
			reserveContribution: position.reserveContribution,
			collateral: position.collateral,
			collateralName: position.collateralName,
			collateralSymbol: position.collateralSymbol,
			collateralDecimals: position.collateralDecimals,
		};
	}

	const getFeeTimeframe = function (): number {
		const OneMonth = 60 * 60 * 24 * 30;
		const secToExp = Math.floor(parseInt(missingPositionData.expiration.toString()) - parseInt(event.block.timestamp.toString()));
		return Math.max(OneMonth, secToExp);
	};

	const getFeePPM = function (): bigint {
		const OneYear = 60 * 60 * 24 * 365;
		const calc: number = (getFeeTimeframe() * missingPositionData.annualInterestPPM) / OneYear;
		return BigInt(Math.floor(calc));
	};

	const getFeePaid = function (amount: bigint): bigint {
		return (getFeePPM() * amount) / 1_000_000n;
	};

	if (status.mintingUpdatesCounter == 1n) {
		await context.db.insert(MintingHubV1MintingUpdateV1).values({
			count: 1n,
			txHash: event.transaction.hash,
			created: event.block.timestamp,
			position: normalizeAddress(missingPositionData.position),
			owner: normalizeAddress(missingPositionData.owner),
			isClone: normalizeAddress(missingPositionData.original) !== normalizeAddress(missingPositionData.position),
			collateral: normalizeAddress(missingPositionData.collateral),
			collateralName: missingPositionData.collateralName,
			collateralSymbol: missingPositionData.collateralSymbol,
			collateralDecimals: missingPositionData.collateralDecimals,
			size: collateral,
			price: price,
			minted: minted,
			sizeAdjusted: collateral,
			priceAdjusted: price,
			mintedAdjusted: minted,
			annualInterestPPM: missingPositionData.annualInterestPPM,
			reserveContribution: missingPositionData.reserveContribution,
			feeTimeframe: getFeeTimeframe(),
			feePPM: parseInt(getFeePPM().toString()),
			feePaid: getFeePaid(minted),
		});
	} else {
		const prev = await context.db.find(MintingHubV1MintingUpdateV1, {
			position: normalizeAddress(missingPositionData.position),
			count: status.mintingUpdatesCounter - 1n,
		});
		if (prev == null) {
			console.error('Previous minting update not found:', {
				position: missingPositionData.position,
				expectedCount: status.mintingUpdatesCounter - 1n,
				currentCount: status.mintingUpdatesCounter,
				txHash: event.transaction.hash,
				blockNumber: event.block.number,
			});
			throw new Error(`previous minting update not found.`);
		}

		const sizeAdjusted = collateral - prev.size;
		const priceAdjusted = price - prev.price;
		const mintedAdjusted = minted - prev.minted;

		await context.db.insert(MintingHubV1MintingUpdateV1).values({
			count: status.mintingUpdatesCounter,
			txHash: event.transaction.hash,
			created: event.block.timestamp,
			position: normalizeAddress(missingPositionData.position),
			owner: normalizeAddress(missingPositionData.owner),
			isClone: normalizeAddress(missingPositionData.original) !== normalizeAddress(missingPositionData.position),
			collateral: normalizeAddress(missingPositionData.collateral),
			collateralName: missingPositionData.collateralName,
			collateralSymbol: missingPositionData.collateralSymbol,
			collateralDecimals: missingPositionData.collateralDecimals,
			size: collateral,
			price: price,
			minted: minted,
			sizeAdjusted,
			priceAdjusted,
			mintedAdjusted,
			annualInterestPPM: missingPositionData.annualInterestPPM,
			reserveContribution: missingPositionData.reserveContribution,
			feeTimeframe: getFeeTimeframe(),
			feePPM: parseInt(getFeePPM().toString()),
			feePaid: mintedAdjusted > 0n ? getFeePaid(mintedAdjusted) : 0n,
		});
	}
});

ponder.on('PositionV1:PositionDenied', async ({ event, context }) => {
	const { client } = context;

	const position = await context.db.find(MintingHubV1PositionV1, {
		position: normalizeAddress(event.log.address),
	});

	const cooldown = await client.readContract({
		abi: context.contracts.PositionV1.abi,
		address: event.log.address,
		functionName: 'cooldown',
	});

	if (position) {
		await context.db
			.update(MintingHubV1PositionV1, {
				position: normalizeAddress(event.log.address),
			})
			.set({
				cooldown,
				denied: true,
				denyDate: event.block.timestamp,
			});
	}
});

ponder.on('PositionV1:OwnershipTransferred', async ({ event, context }) => {
	// update owner counter
	const status = await context.db
		.insert(MintingHubV1Status)
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
		}));

	await context.db
		.insert(MintingHubV1OwnerTransfersV1)
		.values({
			version: 1,
			position: normalizeAddress(event.log.address),
			count: status.ownerTransfersCounter,
			created: event.block.timestamp,
			previousOwner: normalizeAddress(event.args.previousOwner),
			newOwner: normalizeAddress(event.args.newOwner),
			txHash: event.transaction.hash,
		})
		.onConflictDoNothing();

	const position = await context.db.find(MintingHubV1PositionV1, {
		position: normalizeAddress(event.log.address),
	});

	if (position) {
		await context.db
			.update(MintingHubV1PositionV1, {
				position: normalizeAddress(event.log.address),
			})
			.set({
				owner: normalizeAddress(event.args.newOwner),
			});
	}
});
