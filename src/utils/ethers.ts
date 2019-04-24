// Utility functions for ethers.js

import { Provider, BaseProvider } from "ethers/providers";
import { ethers } from "ethers";
import { ConfigurationError } from "../dataEntities";
import logger from "../logger";

/**
 * A simple custom Error class to provide more details in case of a re-org.
 */
export class ReorgError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReorgError";
    }
}

/**
 * Observes the `provider` for new blocks until the transaction `txHash` has `confirmationsRequired` confirmations.
 * Throws a `ReorgError` if the corresponding transaction is not found; assuming that it was found when this function
 * is called, this is likely caused by a block re-org.
 *
 * @param provider
 * @param txHash
 * @param confirmationsRequired
 */
export function waitForConfirmations(provider: Provider, txHash: string, confirmationsRequired: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            provider.removeListener("block", newBlockHandler);
        };

        const newBlockHandler = async () => {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt == null) {
                // There was likely a re-org at this provider.
                cleanup();
                reject(
                    new ReorgError("There could have been a re-org, the transaction was sent but was later not found.")
                );
            } else if (receipt.confirmations >= confirmationsRequired) {
                cleanup();
                resolve();
            }
        };
        provider.on("block", newBlockHandler);
    });
}

/**
 * Adds a delay to the provider. When polling, or getting block number, or waiting for confirmations,
 * the provider will behave as if the head is delay blocks deep. Use this function with caution,
 * it depends on the internal behaviour of ethersjs to function correctly, and as such is very
 * brittle. A better long term solution would be persist events observed via ethers js, and act
 * upon them later.
 * @param provider
 * @param delay
 */
export const withDelay = (provider: BaseProvider, delay: number): void => {
    const perform = provider.perform.bind(provider);
    provider.perform = async (method: any, params: any) => {
        let performResult = await perform(method, params);
        if (method === "getBlockNumber") {
            var value = parseInt(performResult);
            if (value != performResult) {
                throw new Error("invalid response - getBlockNumber");
            }
            if (value < delay) {
                throw new Error(`invalid delay - cannot delay: ${delay} more than block height: ${value}`);
            }
            performResult = value - delay;
        }
        return performResult;
    };
};

// TODO:113: move the tests for start stoppable elsewhere
// TODO:113: document this class
// TODO:113: move this class elsewhere
export abstract class StartStoppable {
    constructor(private readonly name: string) {}
    private mStarted: boolean;
    protected get started() {
        return this.mStarted;
    }
    protected set started(value) {
        this.mStarted = value;
    }

    /**
     * Start this service
     */
    public async start() {
        if (this.started) throw new ConfigurationError(`${this.name}: Already started.`);
        await this.startInternal();
        this.started = true;
        logger.info(`${this.name}: Started.`);
    }
    protected abstract async startInternal();

    /**
     * Stop this service
     */
    public async stop() {
        if (this.started) {
            this.started = false;
            await this.stopInternal();
            logger.info(`${this.name}: Stopped.`);
        } else {
            logger.error(`${this.name}: Already stopped.`);
        }
    }
    protected abstract async stopInternal();
}

// TODO:113: docs
// TODO:113: should we be in this class
// TODO:113: tests
export class BlockCacher extends StartStoppable {
    constructor(private readonly provider: ethers.providers.Provider) {
        super("BC");
    }

    private boundUpdateBlocks = this.updateBlocks.bind(this);

    private mBlockNumber: number;
    public get blockNumber() {
        if (this.started) return this.mBlockNumber;
    }

    private mBlockHash: string;
    public get blockHash() {
        return this.mBlockHash;
    }

    protected async startInternal() {
        this.provider.on("block", this.boundUpdateBlocks);
        const blockNumber = await this.provider.getBlockNumber();
        await this.updateBlocks(blockNumber);
    }
    protected async stopInternal() {
        this.provider.removeListener("block", this.boundUpdateBlocks);
    }

    public async updateBlocks(blockNumber: number) {
        const block = await this.provider.getBlock(blockNumber, false);
        this.mBlockHash = block.hash;
        this.mBlockNumber = block.number;
    }
}
