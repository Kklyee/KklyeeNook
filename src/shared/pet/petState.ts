export type PetActivity = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'success';

export type PetState = { activity: PetActivity; currentTool?: string; message?: string };

export const initialPetState: PetState = { activity: 'idle' };
