"use server";

import { getOperationsSnapshot } from "../domain/operations";

export async function getMerchantOperationsSnapshot() {
  return getOperationsSnapshot();
}
