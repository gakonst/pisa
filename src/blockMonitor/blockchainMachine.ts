import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./blockStub";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TAnchorState extends object, TAuxState extends object> extends EventEmitter {
    public static NEW_STATE_EVENT = "new_state";

    private blockStates = new WeakMap<IBlockStub, TAnchorState>();
    private mHeadState: TAnchorState | null = null;

    private auxiliaryState: TAuxState;

    public get headState() {
        return this.mHeadState;
    }

    constructor(
        private blockProcessor: BlockProcessor,
        private initialAnchorState: TAnchorState,
        initialAuxiliaryState: TAuxState,
        private reducer: (
            prevAnchorState: TAnchorState,
            prevAuxState: TAuxState,
            block: IBlockStub
        ) => [TAnchorState, TAuxState]
    ) {
        super();

        this.auxiliaryState = initialAuxiliaryState;
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
        let state: TAnchorState | null = null;
        for (const block of ancestorsToAdd) {
            const parentBlock = this.blockProcessor.blockCache.getBlockStub(block.parentHash);

            // the previous state is the state of the parent block if available, or the initial state otherwise
            const prevAnchorState = parentBlock ? this.blockStates.get(parentBlock)! : this.initialAnchorState;

            [state, this.auxiliaryState] = this.reducer(prevAnchorState, this.auxiliaryState, block);
            this.blockStates.set(block, state);
        }

        const oldState = this.headState;
        this.mHeadState = state;

        // TODO: should we (deeply) compare old state and new state and only emit if different?
        // Probably not, it might be expensive/inefficient depending on what is in TAnchorState
        this.emit(BlockchainMachine.NEW_STATE_EVENT, oldState, state);
    }
}
