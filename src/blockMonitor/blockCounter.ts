import { EventEmitter } from "events";
import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./blockStub";
import { BlockchainMachine } from "./blockchainMachine";

/***** Example state for a tool based on the blockchain state machine **************/

// Description of the state
interface BlockCounterState {
    [suffix: string]: {
        count: number;
    };
}

// initial state
const blockCounterInitialState: BlockCounterState = {};

// This tool counts the number of blocks whose hash ends with a given hex digit, and emits an event when
// a suffix appears for the third time.
export class BlockCounter extends EventEmitter {
    public static SUFFIX_THRESHOLD_EVENT = "suffix_threshold";

    private stateMachine: BlockchainMachine<BlockCounterState>;

    private reducer(oldState: BlockCounterState, block: IBlockStub): BlockCounterState {
        const suffix = block.hash.substr(-1);
        return {
            ...oldState,
            [suffix]: {
                count: oldState[suffix].count + 1
            }
        };
    }

    private handleStateChange(oldState: BlockCounterState, newState: BlockCounterState) {
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
        this.stateMachine = new BlockchainMachine(blockProcessor, {}, this.reducer);
        this.stateMachine.on(BlockchainMachine.NEW_STATE_EVENT, this.handleStateChange);
    }
}
