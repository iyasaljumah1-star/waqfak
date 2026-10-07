/**
 * Lets CLI scripts (tsx --conditions=react-server) load server modules that import `next/navigation`
 * (e.g. authz/context → redirect). Outside the Next bundler that specifier resolves to the client build,
 * which calls React.createContext and crashes under the react-server condition; the react-server build
 * exports the same server APIs (redirect, notFound, …). Import this file FIRST.
 */
import Module from "node:module";

const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const original = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "next/navigation") request = "next/dist/client/components/navigation.react-server";
  return original.call(this, request, ...rest);
};
