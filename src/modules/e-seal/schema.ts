export type SealConfig =
  | { tampilan: 'INVISIBLE'; reason: string }
  | {
      tampilan: 'VISIBLE';
      reason: string;
      page: number;
      originX: number;
      originY: number;
      width: number;
      height: number;
      location: string;
    };
