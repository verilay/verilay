import { Api, getClient } from '@chainsafe/lodestar-api';
import { config } from '@chainsafe/lodestar-config/default';
import { createIBeaconConfig, IBeaconConfig } from '@chainsafe/lodestar-config';
import { toHexString } from '@chainsafe/ssz';
import { DOMAIN_SYNC_COMMITTEE } from '@chainsafe/lodestar-params';
import { ssz, altair } from '@chainsafe/lodestar-types';
import { isValidMerkleBranch } from '@chainsafe/lodestar-light-client/lib/utils/verifyMerkleBranch';
import { computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot } from '@chainsafe/lodestar-light-client/lib/utils/clock';

import { createNodeFromProof } from '@chainsafe/persistent-merkle-tree';
import { createSingleProof } from '@chainsafe/persistent-merkle-tree/lib/proof/single';

import { ChainRelayUpdate } from './types';
import { logger } from './utils/logger';

export default class BeaconChainClient {
    clientNode: Api;

    static readonly FINALIZED_ROOT_INDEX = 105;

    // static readonly CURRENT_SYNC_COMMITTEE_INDEX = 54;
    static readonly NEXT_SYNC_COMMITTEE_INDEX = 55;

    static readonly SLOT_INDEX = 8;

    static readonly STATE_ROOT_INDEX = 11;

    static readonly SLOTS_PER_EPOCH = 32;

    constructor(_url: string) {
        this.clientNode = getClient(config, { baseUrl: _url });
    }

    private static fromGindex = (gindex: number): [number, number] => {
        const depth = Math.floor(Math.log2(gindex));
        const firstIndex = 2 ** depth;
        return [depth, gindex % firstIndex];
    };

    public getCommitteeUpdateData = async (
        _syncCommitteePeriod: number,
    ): Promise<ChainRelayUpdate> => {
        const [prevCommitteeUpdate, committeeUpdate] = (await this.clientNode.lightclient.getCommitteeUpdates(_syncCommitteePeriod - 1, _syncCommitteePeriod)).data;
        const finalizedBlockHeader = committeeUpdate.header;
        const finalizedSlot = finalizedBlockHeader.slot;
        const finalizedStateRoot = finalizedBlockHeader.stateRoot;
        const finalizedBlockRoot = (await this.clientNode.beacon.getBlockRoot(finalizedSlot)).data;
        logger.info('finalized slot: ', committeeUpdate.header.slot);
        logger.info('finalizing slot: ', committeeUpdate.finalityHeader.slot);

        const latestBlockHeader = committeeUpdate.finalityHeader;
        const latestSlot = latestBlockHeader.slot;
        const latestBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(latestBlockHeader);
        const latestStateRoot = latestBlockHeader.stateRoot;

        const { nextSyncCommitteeBranch } = committeeUpdate;
        const { nextSyncCommittee } = committeeUpdate;

        logger.debug('latest block root: ', toHexString(latestBlockRoot));
        const stateRootBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(latestBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.STATE_ROOT_INDEX));

        logger.debug(
            'stateRootBranch valid: ',
            isValidMerkleBranch(
                latestStateRoot.valueOf() as Uint8Array,
                stateRootBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.STATE_ROOT_INDEX),
                latestBlockRoot.valueOf() as Uint8Array,
            ),
        );

        const latestSlotBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(latestBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.SLOT_INDEX));
        // logger.info('latestSlotBranch: ', latestSlotBranch.map(toHexString));

        logger.debug(
            'latestSlotBranch valid: ',
            isValidMerkleBranch(
                ssz.Slot.hashTreeRoot(latestSlot),
                latestSlotBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.SLOT_INDEX),
                latestBlockRoot.valueOf() as Uint8Array,
            ),
        );

        const finalizedStateRootBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(finalizedBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.STATE_ROOT_INDEX));
        // logger.info('finalizedStateRootBranch: ', finalizedStateRootBranch.map(toHexString));

        logger.debug(
            'finalizedStateRootBranch valid: ',
            isValidMerkleBranch(
                finalizedStateRoot.valueOf() as Uint8Array,
                finalizedStateRootBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.STATE_ROOT_INDEX),
                finalizedBlockRoot.valueOf() as Uint8Array,
            ),
        );

        const finalizedSlotBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(finalizedBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.SLOT_INDEX));
        // logger.info('finalizedSlotBranch: ', finalizedSlotBranch.map(toHexString));

        logger.debug(
            'finalizedSlotBranch valid: ',
            isValidMerkleBranch(
                ssz.Slot.hashTreeRoot(finalizedSlot),
                finalizedSlotBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.SLOT_INDEX),
                finalizedBlockRoot.valueOf() as Uint8Array,
            ),
        );

        logger.debug(
            'nextSyncCommitteeBranch valid: ',
            isValidMerkleBranch(
                ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
                Array.from(nextSyncCommitteeBranch).map((val) => val.valueOf() as Uint8Array),
                ...BeaconChainClient.fromGindex(BeaconChainClient.NEXT_SYNC_COMMITTEE_INDEX),
                finalizedStateRoot.valueOf() as Uint8Array,
            ),
        );

        logger.debug(
            'finalizingBranch valid: ',
            isValidMerkleBranch(
                finalizedBlockRoot.valueOf() as Uint8Array,
                Array.from(committeeUpdate.finalityBranch).map((val) => val.valueOf() as Uint8Array),
                ...BeaconChainClient.fromGindex(BeaconChainClient.FINALIZED_ROOT_INDEX),
                latestStateRoot.valueOf() as Uint8Array,
            ),
        );

        logger.debug('state root: ', toHexString(latestStateRoot));
        logger.debug('body root: ', toHexString(latestBlockHeader.bodyRoot));

        logger.debug('finalized block state root: ', toHexString(finalizedStateRoot));

        const { genesisValidatorsRoot } = (await this.clientNode.beacon.getGenesis()).data;
        const beaconConfig: IBeaconConfig = createIBeaconConfig(config, genesisValidatorsRoot);
        const domain = beaconConfig.getDomain(DOMAIN_SYNC_COMMITTEE, latestSlot);

        const syncCommittee = prevCommitteeUpdate.nextSyncCommittee.pubkeys;
        const syncCommitteeBranch = prevCommitteeUpdate.nextSyncCommitteeBranch;
        const syncCommitteeAggregate = prevCommitteeUpdate.nextSyncCommittee.aggregatePubkey;

        // const { BeaconState } = beaconConfig.getForkTypes(latestSlot);
        // const path = ['blockRoots'];
        // const { gindex } = BeaconState.getPathInfo(path);
        // logger.debug('gindex: ', gindex);
        // const proof = (await this.clientNode.lightclient.getStateProof('head',[path])).data;
        // const [history, historyBranch] = createSingleProof(createNodeFromProof(proof), gindex);
        // logger.info('history root: ', toHexString(history));

        return {
            signature: toHexString(committeeUpdate.syncCommitteeSignature),
            participants: Array.from(committeeUpdate.syncCommitteeBits),
            latestBlockRoot: toHexString(latestBlockRoot),
            signingDomain: toHexString(domain),
            stateRoot: toHexString(latestStateRoot),
            stateRootBranch: stateRootBranch.map(toHexString),
            latestSlot,
            latestSlotBranch: latestSlotBranch.map(toHexString),
            finalizedBlockRoot: toHexString(finalizedBlockRoot),
            finalizingBranch: Array.from(committeeUpdate.finalityBranch).map(toHexString),
            finalizedSlot,
            finalizedSlotBranch: finalizedSlotBranch.map(toHexString),
            finalizedStateRoot: toHexString(finalizedStateRoot),
            finalizedStateRootBranch: finalizedStateRootBranch.map(toHexString),
            syncCommittee: Array.from(syncCommittee).map(toHexString),
            syncCommitteeAggregate: toHexString(syncCommitteeAggregate),
            syncCommitteeBranch: Array.from(syncCommitteeBranch).map(toHexString),
        };
    };

    public getBlockUpdateDataForEpoch = async (
        _epoch: number,
    ): Promise<ChainRelayUpdate> => {
        const { genesisValidatorsRoot } = (await this.clientNode.beacon.getGenesis()).data;
        const beaconConfig: IBeaconConfig = createIBeaconConfig(config, genesisValidatorsRoot);

        const finalizedSlot = BeaconChainClient.SLOTS_PER_EPOCH * _epoch;

        // TODO: check reasoning
        // the earliest finalization block appears after two epochs
        const latestSlot = finalizedSlot + BeaconChainClient.SLOTS_PER_EPOCH * 2;

        const signedLatestBlockHeader = (await this.clientNode.beacon.getBlockHeader(latestSlot)).data.header;
        const latestBlockHeader = signedLatestBlockHeader.message;
        const stateRootBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(latestBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.STATE_ROOT_INDEX));
        const latestStateRoot = latestBlockHeader.stateRoot;
        const latestBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(latestBlockHeader);

        const { BeaconState } = beaconConfig.getForkTypes(latestSlot);
        const domain = beaconConfig.getDomain(DOMAIN_SYNC_COMMITTEE, latestSlot);

        // const proof = (await this.clientNode.lightclient.getStateProof(toHexString(latestStateRoot), [['finalized_checkpoint']]));
        logger.info(
            'stateRootBranch valid: ',
            isValidMerkleBranch(
                latestStateRoot.valueOf() as Uint8Array,
                stateRootBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.STATE_ROOT_INDEX),
                latestBlockRoot.valueOf() as Uint8Array,
            ),
        );

        const latestSlotBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(latestBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.SLOT_INDEX));
        logger.info(
            'latestSlotBranch valid: ',
            isValidMerkleBranch(
                ssz.Slot.hashTreeRoot(latestSlot),
                latestSlotBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.SLOT_INDEX),
                latestBlockRoot.valueOf() as Uint8Array,
            ),
        );

        let path = ['finalizedCheckpoint', 'root'];
        const finalityProof = (await this.clientNode.lightclient.getStateProof(toHexString(latestStateRoot), [path])).data;
        const [finalizedBlockRoot, finalityBranch] = createSingleProof(createNodeFromProof(finalityProof), BigInt(BeaconChainClient.FINALIZED_ROOT_INDEX));

        logger.info(
            'finalizingBranch valid: ',
            isValidMerkleBranch(
                finalizedBlockRoot.valueOf() as Uint8Array,
                finalityBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.FINALIZED_ROOT_INDEX),
                latestStateRoot.valueOf() as Uint8Array,
            ),
        );

        logger.info('computed finalizedBlockRoot: ', toHexString((await this.clientNode.beacon.getBlockRoot(finalizedSlot)).data));
        logger.info('actual finalizedBlockRoot: ', toHexString(finalizedBlockRoot));
        const finalizedBlockHeader = (await this.clientNode.beacon.getBlockHeader(toHexString(finalizedBlockRoot))).data.header.message;
        const finalizedStateRoot = finalizedBlockHeader.stateRoot;
        // const finalizedSlot = finalizedBlockHeader.slot;
        const finalizedStateRootBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(finalizedBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.STATE_ROOT_INDEX));
        logger.info('finalizedStateRoot: ', toHexString(finalizedStateRoot));

        logger.info(
            'finalizedStateRootBranch valid: ',
            isValidMerkleBranch(
                finalizedStateRoot.valueOf() as Uint8Array,
                finalizedStateRootBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.STATE_ROOT_INDEX),
                finalizedBlockRoot.valueOf() as Uint8Array,
            ),
        );

        const finalizedSlotBranch = ssz.phase0.BeaconBlockHeader.createTreeBackedFromStruct(finalizedBlockHeader).tree.getSingleProof(BigInt(BeaconChainClient.SLOT_INDEX));
        // logger.info('finalizedSlotBranch: ', finalizedSlotBranch.map(toHexString));

        logger.info(
            'finalizedSlotBranch valid: ',
            isValidMerkleBranch(
                ssz.Slot.hashTreeRoot(finalizedSlot),
                finalizedSlotBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.SLOT_INDEX),
                finalizedBlockRoot.valueOf() as Uint8Array,
            ),
        );

        path = ['nextSyncCommittee'];
        const { gindex } = BeaconState.getPathInfo(path);
        logger.debug('gindex: ', gindex);

        logger.info('finalized slot: ', finalizedSlot);
        logger.info('finalizedStateRoot: ', toHexString(finalizedStateRoot));
        const nextSyncCommitteeProof = (await this.clientNode.lightclient.getStateProof(toHexString(finalizedStateRoot), [path])).data;
        const [nextSyncCommitteeRoot, nextSyncCommitteeBranch] = createSingleProof(createNodeFromProof(nextSyncCommitteeProof), gindex);

        const syncPeriod = computeSyncPeriodAtSlot(beaconConfig, finalizedSlot);
        const { nextSyncCommittee } = (await this.clientNode.lightclient.getCommitteeUpdates(syncPeriod, syncPeriod)).data[0];

        logger.debug('roots equal: ', toHexString(nextSyncCommitteeRoot) === toHexString(ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee)));

        const { syncCommitteeSignature, syncCommitteeBits } = ((await this.clientNode.beacon.getBlock(finalizedSlot)).data.message as altair.BeaconBlock).body.syncAggregate;

        logger.info(
            'nextSyncCommitteeBranch valid: ',
            isValidMerkleBranch(
                nextSyncCommitteeRoot,
                nextSyncCommitteeBranch,
                ...BeaconChainClient.fromGindex(BeaconChainClient.NEXT_SYNC_COMMITTEE_INDEX),
                finalizedStateRoot.valueOf() as Uint8Array,
            ),
        );

        return {
            signature: toHexString(syncCommitteeSignature),
            participants: Array.from(syncCommitteeBits),
            latestBlockRoot: toHexString(latestBlockRoot),
            signingDomain: toHexString(domain),
            stateRoot: toHexString(latestStateRoot),
            stateRootBranch: stateRootBranch.map(toHexString),
            latestSlot,
            latestSlotBranch: latestSlotBranch.map(toHexString),
            finalizedBlockRoot: toHexString(finalizedBlockRoot),
            finalizingBranch: Array.from(finalityBranch).map(toHexString),
            finalizedSlot,
            finalizedSlotBranch: finalizedSlotBranch.map(toHexString),
            finalizedStateRoot: toHexString(finalizedStateRoot),
            finalizedStateRootBranch: finalizedStateRootBranch.map(toHexString),
            syncCommittee: Array.from(nextSyncCommittee.pubkeys).map(toHexString),
            syncCommitteeAggregate: toHexString(nextSyncCommittee.aggregatePubkey),
            syncCommitteeBranch: Array.from(nextSyncCommitteeBranch).map(toHexString),
        };
    };

    public getBlockUpdateForEpoch = async (
        _epoch: number,
    ): Promise<ChainRelayUpdate> => {
        const syncCommitteePeriod = computeSyncPeriodAtEpoch(config, _epoch);
        return this.getCommitteeUpdateData(syncCommitteePeriod);
    };

    public getLatestSyncCommitteePeriod = async (): Promise<number> => {
        // TODO: could be computed w/o node interaction
        const latestBlockHeader = (await this.clientNode.beacon.getBlockHeader('head')).data;
        const latestSlot = latestBlockHeader.header.message.slot;
        return computeSyncPeriodAtSlot(config, latestSlot);
    };
}
