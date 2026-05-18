import { onchainTable, primaryKey } from 'ponder';

export const CCIPAdminProposal = onchainTable(
	'CCIPAdminProposal',
	(t) => ({
		chainId: t.integer().notNull(),
		hash: t.hex().notNull(),
		proposer: t.hex(),
		type: t.text(), // 'AddChain' | 'RemoveChain' | 'RemotePoolUpdate' | 'AdminTransfer'
		deadline: t.bigint().notNull(),
		status: t.text().notNull(), // 'Pending' | 'Denied' | 'Enacted'
		details: t.text(),
		created: t.bigint().notNull(),
		deniedAt: t.bigint(),
		enactedAt: t.bigint(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.hash] }),
	})
);

export const CCIPAdminChain = onchainTable(
	'CCIPAdminChain',
	(t) => ({
		chainId: t.integer().notNull(),
		remoteChainSelector: t.bigint().notNull(),
		active: t.boolean().notNull(),
		remoteTokenAddress: t.text(),
		outboundEnabled: t.boolean().notNull(),
		outboundCapacity: t.bigint().notNull(),
		outboundRate: t.bigint().notNull(),
		inboundEnabled: t.boolean().notNull(),
		inboundCapacity: t.bigint().notNull(),
		inboundRate: t.bigint().notNull(),
		rateLimitUpdatedAt: t.bigint(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.remoteChainSelector] }),
	})
);
