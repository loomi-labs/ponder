import { ADDRESS } from '@frankencoin/zchf';
import { type Context } from 'ponder:registry';
import { Address } from 'viem';
import { mainnet } from 'viem/chains';
import { normalizeAddress } from './format';

export const CLONE_HELPER = normalizeAddress(ADDRESS[mainnet.id].cloneHelper);
// keccak256("OwnershipTransferred(address,address)")
export const OWNERSHIP_TRANSFERRED_TOPIC =
	'0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0' as const;
// keccak256("MintingUpdate(uint256,uint256,uint256)")
export const MINTING_UPDATE_TOPIC_V2 =
	'0x9483a26ad376f30b5199a79e75df3bb05158c4ee32a348f53e83245a5e50c86e' as const;
// keccak256("MintingUpdate(uint256,uint256,uint256,uint256)")
export const MINTING_UPDATE_TOPIC_V1 =
	'0xcb2040b7eb3265a4335698c9ecbe81a5f9857e92aa32e07ce235f44c321a7e35' as const;

/**
 * When a position is opened or minted via CloneHelper, event.args.owner is
 * still the CloneHelper address at the time the log fires. This reads the
 * transaction receipt to find the CloneHelper→beneficiary OwnershipTransferred
 * log and returns the actual owner.
 */
export async function resolvePositionOwner(
	owner: Address,
	positionAddress: Address,
	txHash: `0x${string}`,
	client: Context['client']
): Promise<Address> {
	if (owner !== CLONE_HELPER) return owner;

	const receipt = await client.getTransactionReceipt({ hash: txHash });

	for (const log of receipt.logs) {
		if (
			normalizeAddress(log.address) === positionAddress &&
			log.topics[0] === OWNERSHIP_TRANSFERRED_TOPIC &&
			log.topics[1] !== undefined &&
			log.topics[2] !== undefined &&
			normalizeAddress(('0x' + log.topics[1].slice(26)) as Address) === CLONE_HELPER
		) {
			return normalizeAddress(('0x' + log.topics[2].slice(26)) as Address);
		}
	}

	return owner;
}
