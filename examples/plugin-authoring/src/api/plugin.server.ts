"use server";

export async function getPluginMessage() {
  return {
    message: "Plugin endpoint configured by config hook",
    nodeEnv: process.env.NODE_ENV,
  };
}
