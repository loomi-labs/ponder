import { ponder, Context } from 'ponder:registry';
import { CommonEcosystem, TransferReference } from 'ponder:schema';
import { Address, Hash, zeroAddress } from 'viem';
import { normalizeAddress } from './utils/format';

/*
Events

TransferReference
event Transfer(address indexed from, address indexed to, uint256 amount, string ref);
event CrossTransfer(address indexed sender, address indexed from, uint64 toChain, bytes indexed to, uint256 amount, string ref);

CrossChainReference
event Transfer(address indexed from, address indexed to, uint256 amount, string ref);
event CrossTransfer(address indexed sender, address indexed from, uint64 toChain, bytes indexed to, uint256 amount, string ref);

CrossChainERC20
event Transfer(address indexed from, uint64 toChain, bytes indexed to, uint256 value);
*/

ponder.on('TransferReference:CrossTransfer', async ({ event, context }) => {
	const counter = await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'TransferReference:Counter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	const target = await getTargetAddress(context.client, event.transaction.hash);

	await context.db.insert(TransferReference).values({
		chainId: context.chain.id,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
		sender: event.args.sender,
		from: event.args.from,
		to: target,
		toBytes: event.args.to,
		targetChain: event.args.toChain,
		amount: event.args.amount,
		reference: event.args.ref,
	});
});

ponder.on(
	'TransferReference:Transfer(address indexed from, address indexed to, uint256 amount, string ref)',
	async ({ event, context }) => {
		const counter = await context.db
			.insert(CommonEcosystem)
			.values({
				id: 'TransferReference:Counter',
				value: '',
				amount: 1n,
			})
			.onConflictDoUpdate((current) => ({
				amount: current.amount + 1n,
			}));

		await context.db.insert(TransferReference).values({
			chainId: context.chain.id,
			count: counter.amount,
			created: event.block.timestamp,
			txHash: event.transaction.hash,
			sender: event.transaction.from,
			from: event.args.from,
			to: event.args.to,
			toBytes: '0x', // no bytes
			targetChain: 0n, // mainnet tx with ref
			amount: event.args.amount,
			reference: event.args.ref,
		});
	}
);

ponder.on(
	'TransferReference:Transfer(address indexed from, uint64 toChain, bytes indexed to, uint256 value)',
	async ({ event, context }) => {
		const counter = await context.db
			.insert(CommonEcosystem)
			.values({
				id: 'TransferReference:Counter',
				value: '',
				amount: 1n,
			})
			.onConflictDoUpdate((current) => ({
				amount: current.amount + 1n,
			}));

		const target = await getTargetAddress(context.client, event.transaction.hash);

		await context.db.insert(TransferReference).values({
			chainId: context.chain.id,
			count: counter.amount,
			created: event.block.timestamp,
			txHash: event.transaction.hash,
			sender: event.transaction.from,
			from: event.args.from,
			to: target,
			toBytes: event.args.to,
			targetChain: event.args.toChain,
			amount: event.args.value,
			reference: '', // ref is empty string
		});
	}
);

// CCIPSendRequested (CCIP v1) — recipient at ABI slot index 3
const CCIPSendRequested = '0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd';
// CCIPMessageSent (CCIP v1.5+) — recipient at ABI slot index 6
const CCIPMessageSent = '0x192442a2b2adb6a7948f097023cb6b57d29d3a7a5dd33e6666d33c39cc456f32';

// @dev: extracts the recipient address from the CCIP event in the same transaction;
// supports both CCIPSendRequested (v1, slot 3) and CCIPMessageSent (v1.5+, slot 6)
async function getTargetAddress(client: Context['client'], hash: Hash): Promise<Address> {
	const tx = await client.getTransactionReceipt({ hash });

	let slotIndex: number | undefined;
	let logData: string | undefined;

	for (const log of tx.logs) {
		if (log.topics.includes(CCIPSendRequested as never)) {
			slotIndex = 3;
			logData = log.data;
			break;
		}
		if (log.topics.includes(CCIPMessageSent as never)) {
			slotIndex = 6;
			logData = log.data;
			break;
		}
	}

	if (slotIndex === undefined || !logData) {
		console.warn(`No CCIP event found in transaction ${hash}, storing zero address`);
		return zeroAddress;
	}

	// 2 (0x prefix) + 64*slotIndex (skip preceding 32-byte slots) + 24 (12-byte zero padding before address)
	const offset = 2 + 64 * slotIndex + 24;
	const addressLength = 40;

	if (logData.length < offset + addressLength) {
		throw new Error(
			`Insufficient data in CCIP event for transaction ${hash}: expected at least ${offset + addressLength} chars, got ${logData.length}`
		);
	}

	const extracted = logData.slice(offset, offset + addressLength);

	if (!/^[0-9a-fA-F]{40}$/.test(extracted)) {
		throw new Error(`Invalid address extracted from CCIP data in transaction ${hash}: ${extracted}`);
	}

	return normalizeAddress(`0x${extracted}`);
}
