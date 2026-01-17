// Based on PrusaLink API v1.0.0 specification
export type PrinterState =
  | "IDLE"
  | "BUSY"
  | "PRINTING"
  | "PAUSED"
  | "FINISHED"
  | "STOPPED"
  | "ERROR"
  | "ATTENTION"
  | "READY";

export interface StatusPrinter {
  state: PrinterState;
  temp_nozzle?: number;
  target_nozzle?: number;
  temp_bed?: number;
  target_bed?: number;
  axis_x?: number;
  axis_y?: number;
  axis_z?: number;
  flow?: number;
  speed?: number;
  fan_hotend?: number;
  fan_print?: number;
  status_printer?: {
    ok: boolean;
    message: string;
  };
  status_connect?: {
    ok: boolean;
    message: string;
  };
}

export interface StatusJob {
  id?: number;
  progress?: number;
  time_remaining?: number;
  time_printing?: number;
  display_name?: string;
  display_path?: string;
}

export interface JobFile {
  name: string;
  display_name: string;
  path: string;
  display_path: string;
  size: number;
  m_timestamp: number;
}

export interface Job {
  id: number;
  state: 'PRINTING' | 'PAUSED' | 'FINISHED' | 'STOPPED' | 'ERROR';
  progress: number;
  time_remaining: number;
  time_printing: number;
  file?: JobFile;
  serial_print?: boolean;
}

export interface StatusTransfer {
  id: number;
  time_transferring: number;
  progress?: number;
  data_transferred?: number;
}

export interface StatusResponse {
  printer: StatusPrinter;
  job?: StatusJob;
  transfer?: StatusTransfer;
}
