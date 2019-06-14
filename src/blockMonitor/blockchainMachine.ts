import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./blockStub";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TState extends object> extends EventEmitter {
    public static NEW_STATE_EVENT = "new_state";

    private blockStates = new WeakMap<IBlockStub, TState>();
    private mHeadState: TState | null = null;

    public get headState() {
        return this.mHeadState;
    }

    constructor(
        private blockProcessor: BlockProcessor,
        private initialState: TState,
        private reducer: (prevState: TState, block: IBlockStub) => TState
    ) {
        super();
        this.processNewHead = this.processNewHead.bind(this);

        blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }

    private processNewHead(blockNumber: number, blockHash: string) {
        // Find all the ancestors that are not already computed
        const ancestorsToAdd: IBlockStub[] = [];
        for (const block of this.blockProcessor.blockCache.ancestry(blockHash)) {
            if (this.blockStates.has(block)) {
                break;
            }
            ancestorsToAdd.push(block);
        }

        // start from the oldest, compute each block's state
        ancestorsToAdd.reverse();
        let state: TState | null = null;
        for (const block of ancestorsToAdd) {
            const parentBlock = this.blockProcessor.blockCache.getBlockStub(block.parentHash);

            // the previous state is the state of the parent block if available, or the initial state otherwise
            const prevState = parentBlock ? this.blockStates.get(parentBlock)! : this.initialState;

            state = this.reducer(prevState, block);
            this.blockStates.set(block, state);
        }

        const oldState = this.headState;
        this.mHeadState = state;

        // TODO: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TState
        this.emit(BlockchainMachine.NEW_STATE_EVENT, oldState, state);
    }
}
