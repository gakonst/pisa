import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./blockStub";
import { BlockchainMachine } from "./blockchainMachine";

/***** Example state for a tool based on the blockchain state machine **************/

// Description of the state
interface BlockCounterAnchorState {
    [suffix: string]: {
        count: number;
    };
}

interface BlockCounterAuxiliaryState {}

// This tool counts the number of blocks whose hash ends with a given hex digit, and emits an event when
// a suffix appears for the third time.
export class BlockCounter extends EventEmitter {
    public static SUFFIX_THRESHOLD_EVENT = "suffix_threshold";

    private stateMachine: BlockchainMachine<BlockCounterAnchorState, BlockCounterAuxiliaryState>;

    private static reducer(
        oldAnchorState: BlockCounterAnchorState,
        oldAuxState: BlockCounterAuxiliaryState,
        block: IBlockStub
    ): [BlockCounterAnchorState, BlockCounterAuxiliaryState] {
        const suffix = block.hash.substr(-1);
        return [
            {
                // anchor state
                ...oldAnchorState,
                [suffix]: {
                    count: oldAnchorState[suffix].count + 1
                }
            },
            {
                //auxiliary state
            }
        ];
    }

    private handleStateChange(oldState: BlockCounterAnchorState, newState: BlockCounterAnchorState) {
        // TODO: do something with the state change
        for (const suffix of Object.keys(oldState)) {
            if (oldState[suffix].count === 2 && newState[suffix].count === 3) {
                this.emit(BlockCounter.SUFFIX_THRESHOLD_EVENT, suffix);
            }
        }
    }

    constructor(private blockProcessor: BlockProcessor) {
        super();

        this.handleStateChange = this.handleStateChange.bind(this);
        this.stateMachine = new BlockchainMachine(blockProcessor, {}, {}, BlockCounter.reducer);
        this.stateMachine.on(BlockchainMachine.NEW_STATE_EVENT, this.handleStateChange);
    }
}
