// cm-chessboard ships no type definitions. This covers the subset the app uses.
declare module 'cm-chessboard' {
  export const COLOR: { white: 'w'; black: 'b' };
  export const INPUT_EVENT_TYPE: {
    moveInputStarted: 'moveInputStarted';
    movingOverSquare: 'movingOverSquare';
    validateMoveInput: 'validateMoveInput';
    moveInputCanceled: 'moveInputCanceled';
    moveInputFinished: 'moveInputFinished';
  };
  export const FEN: { start: string; empty: string };

  export interface MoveInputEvent {
    type: keyof typeof INPUT_EVENT_TYPE;
    squareFrom: string;
    squareTo?: string;
    piece?: string;
  }

  export interface ChessboardProps {
    position?: string;
    orientation?: 'w' | 'b';
    responsive?: boolean;
    assetsUrl?: string;
    style?: {
      cssClass?: string;
      showCoordinates?: boolean;
      pieces?: { file?: string; tileSize?: number };
      animationDuration?: number;
    };
  }

  export class Chessboard {
    constructor(element: HTMLElement, props?: ChessboardProps);
    setPosition(fen: string, animated?: boolean): Promise<void>;
    getPosition(): string;
    setOrientation(color: 'w' | 'b', animated?: boolean): Promise<void>;
    getOrientation(): 'w' | 'b';
    enableMoveInput(handler: (event: MoveInputEvent) => boolean | void, color?: 'w' | 'b'): void;
    disableMoveInput(): void;
    destroy(): void;
  }
}
