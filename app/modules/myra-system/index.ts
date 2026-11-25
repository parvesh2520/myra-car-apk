import { requireOptionalNativeModule } from 'expo-modules-core';

interface MyraSystem {
  availableMemoryMb(): number;
  freeMemory(): Promise<{ beforeMb: number; afterMb: number; apps: number }>;
}

/** Native helpers for low-end head units (modules/myra-system/android). Null outside Android builds. */
export default requireOptionalNativeModule<MyraSystem>('MyraSystem');
