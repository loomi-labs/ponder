import { ponder } from 'ponder:registry';
import { CCIPAdminProposal, CCIPAdminChain } from 'ponder:schema';

const toJson = (obj: unknown): string =>
	JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

// ── Proposal lifecycle ────────────────────────────────────────────────────────

ponder.on('CCIPAdmin:ProposalMade', async ({ event, context }) => {
	const { hash, deadline } = event.args;
	await context.db.insert(CCIPAdminProposal).values({
		chainId: context.chain.id,
		hash,
		deadline: BigInt(deadline),
		status: 'Pending',
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('CCIPAdmin:AddChainProposed', async ({ event, context }) => {
	const { hash, proposer, update } = event.args;
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash }).set({
		proposer,
		type: 'AddChain',
		details: toJson(update),
	});
});

ponder.on('CCIPAdmin:RemoveChainProposed', async ({ event, context }) => {
	const { hash, proposer, chain } = event.args;
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash }).set({
		proposer,
		type: 'RemoveChain',
		details: toJson({ chain }),
	});
});

ponder.on('CCIPAdmin:RemotePoolUpdateProposed', async ({ event, context }) => {
	const { hash, proposer, update } = event.args;
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash }).set({
		proposer,
		type: 'RemotePoolUpdate',
		details: toJson(update),
	});
});

ponder.on('CCIPAdmin:AdminTransferProposed', async ({ event, context }) => {
	const { hash, proposer, newAdmin } = event.args;
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash }).set({
		proposer,
		type: 'AdminTransfer',
		details: toJson({ newAdmin }),
	});
});

ponder.on('CCIPAdmin:ProposalDenied', async ({ event, context }) => {
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash: event.args.hash }).set({
		status: 'Denied',
		deniedAt: event.block.timestamp,
		deniedTxHash: event.transaction.hash,
	});
});

ponder.on('CCIPAdmin:ProposalEnacted', async ({ event, context }) => {
	await context.db.update(CCIPAdminProposal, { chainId: context.chain.id, hash: event.args.hash }).set({
		status: 'Enacted',
		enactedAt: event.block.timestamp,
		enactedTxHash: event.transaction.hash,
	});
});

// ── Chain state ───────────────────────────────────────────────────────────────

ponder.on('CCIPAdmin:ChainAdded', async ({ event, context }) => {
	const { config } = event.args;
	await context.db
		.insert(CCIPAdminChain)
		.values({
			chainId: context.chain.id,
			remoteChainSelector: BigInt(config.remoteChainSelector),
			active: true,
			remoteTokenAddress: config.remoteTokenAddress,
			outboundEnabled: config.outboundRateLimiterConfig.isEnabled,
			outboundCapacity: config.outboundRateLimiterConfig.capacity,
			outboundRate: config.outboundRateLimiterConfig.rate,
			inboundEnabled: config.inboundRateLimiterConfig.isEnabled,
			inboundCapacity: config.inboundRateLimiterConfig.capacity,
			inboundRate: config.inboundRateLimiterConfig.rate,
		})
		.onConflictDoUpdate(() => ({
			active: true,
			remoteTokenAddress: config.remoteTokenAddress,
			outboundEnabled: config.outboundRateLimiterConfig.isEnabled,
			outboundCapacity: config.outboundRateLimiterConfig.capacity,
			outboundRate: config.outboundRateLimiterConfig.rate,
			inboundEnabled: config.inboundRateLimiterConfig.isEnabled,
			inboundCapacity: config.inboundRateLimiterConfig.capacity,
			inboundRate: config.inboundRateLimiterConfig.rate,
		}));
});

ponder.on('CCIPAdmin:ChainRemoved', async ({ event, context }) => {
	const existing = await context.db.find(CCIPAdminChain, { chainId: context.chain.id, remoteChainSelector: BigInt(event.args.id) });
	if (!existing) return;
	await context.db
		.update(CCIPAdminChain, { chainId: context.chain.id, remoteChainSelector: BigInt(event.args.id) })
		.set({ active: false });
});

// Note: RateLimit ABI has inboundConfigs as 2nd param and outboundConfig as 3rd
ponder.on('CCIPAdmin:RateLimit', async ({ event, context }) => {
	const { remoteChain, inboundConfigs, outboundConfig } = event.args;
	await context.db
		.insert(CCIPAdminChain)
		.values({
			chainId: context.chain.id,
			remoteChainSelector: BigInt(remoteChain),
			active: true,
			remoteTokenAddress: null,
			outboundEnabled: outboundConfig.isEnabled,
			outboundCapacity: outboundConfig.capacity,
			outboundRate: outboundConfig.rate,
			inboundEnabled: inboundConfigs.isEnabled,
			inboundCapacity: inboundConfigs.capacity,
			inboundRate: inboundConfigs.rate,
			rateLimitUpdatedAt: event.block.timestamp,
			rateLimitTxHash: event.transaction.hash,
		})
		.onConflictDoUpdate(() => ({
			outboundEnabled: outboundConfig.isEnabled,
			outboundCapacity: outboundConfig.capacity,
			outboundRate: outboundConfig.rate,
			inboundEnabled: inboundConfigs.isEnabled,
			inboundCapacity: inboundConfigs.capacity,
			inboundRate: inboundConfigs.rate,
			rateLimitUpdatedAt: event.block.timestamp,
			rateLimitTxHash: event.transaction.hash,
		}));
});
