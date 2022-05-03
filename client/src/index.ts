import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { TransactionReceipt } from 'web3-core';
import { Contract } from 'web3-eth-contract';

import BeaconChainClient from './beaconChainClient';
import { abi, bytecode } from '../../build/contracts/Eth2ChainRelay_512_NoStorage_Client.json';

export default class VerilayClient {
    relayContract: Contract;

    beaconChainClient: BeaconChainClient;

    senderAccount: string;

    constructor(
        _targetUrl: string,
        _sourceUrl: string,
        _account: string,
        _address?: string,
    ) {
        const web3 = new Web3(_targetUrl);
        this.senderAccount = _account;
        this.relayContract = new web3.eth.Contract(abi as AbiItem[], _address);
        this.beaconChainClient = new BeaconChainClient(_sourceUrl);
    }

    public deployContract = async (
        _signatureThreshold: number,
        _trustingPeriod: number,
        _finalizedBlockRoot: string,
        _finalizedStateRoot: string,
        _finalizedSlot: number,
        _latestSlot: number,
        _latestSlotWithValidatorSetChange: number,
    ): Promise<string> => {
        this.relayContract = await this.relayContract.deploy({
            data: bytecode,
            arguments: [
                _signatureThreshold,
                _trustingPeriod,
                Web3.utils.numberToHex(_finalizedBlockRoot),
                Web3.utils.numberToHex(_finalizedStateRoot),
                _finalizedSlot,
                _latestSlot,
                _latestSlotWithValidatorSetChange,
            ],
        }).send({
            from: this.senderAccount,
            gas: 8000000,
        });
        return this.relayContract.options.address;
    };

    public deployContractAtPeriod = async (
        _syncCommitteePeriod: number,
        _signatureThreshold: number,
        _trustingPeriod: number,
    ): Promise<string> => {
        const updateData = await this.beaconChainClient.getCommitteeUpdateData(_syncCommitteePeriod);

        return this.deployContract(
            _signatureThreshold,
            _trustingPeriod,
            updateData.finalizedBlockRoot,
            updateData.finalizedStateRoot,
            updateData.finalizedSlot,
            updateData.latestSlot,
            updateData.latestSlot - 10000, // ???
        );
    };

    public updateSyncCommittee = async (
        _syncCommitteePeriod: number,
    ): Promise<string> => {
        const updateData = await this.beaconChainClient.getCommitteeUpdateData(_syncCommitteePeriod);

        const receipt: TransactionReceipt = await this.relayContract.methods.submitUpdate(updateData).send({ from: this.senderAccount });
        return receipt.transactionHash;
    };

    public updateEpoch = async (
        _epoch: number,
    ): Promise<string> => {
        const updateData = await this.beaconChainClient.getBlockUpdateDataForEpoch(_epoch);

        const receipt: TransactionReceipt = await this.relayContract.methods.submitUpdate(updateData).send({ from: this.senderAccount });
        return receipt.transactionHash;
    };

    public setRelayContractAddress = (_address: string) => {
        this.relayContract.options.address = _address;
    };
}
