"use server";

export interface MerchantOperator {
  id: string;
  name: string;
}

const operators: MerchantOperator[] = [
  { id: "1", name: "Ada Lovelace" },
  { id: "2", name: "Grace Hopper" },
  { id: "3", name: "Katherine Johnson" },
];

export async function getMerchantOperators() {
  return operators;
}
