export const POSITION_EPSILON = 0.01;   // metres, per axis
export const ROTATION_EPSILON = 0.5;    // degrees, per axis
export const HEARTBEAT_MS = 1000;       // keeps server presence and late joiners correct
export const MAX_SEND_HZ = 20;
export const MIN_SEND_INTERVAL_MS = 1000 / MAX_SEND_HZ;
export const INTERPOLATION_DELAY_MS = 100;  // render this far behind wall clock
export const BUFFER_SIZE = 8;               // samples retained per user
