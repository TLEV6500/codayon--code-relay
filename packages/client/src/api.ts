/**
 * Thin HTTP client for the room lifecycle API (proxied to the relay in dev).
 */

import type { HostParticipation, JoinableRole, Role } from "@codayon/shared";

export interface CreateRoomResponse {
  code: string;
  joinUrl: string;
  hostId: string;
  hostToken: string;
  clientToken: string;
  hostParticipation: HostParticipation;
}

export interface JoinRoomResponse {
  code: string;
  participantId: string;
  role: JoinableRole;
  clientToken: string;
}

export interface BootstrapResponse {
  version: number;
  doc: string;
  phase: "created" | "active" | "ended";
  roster: { id: string; name: string; role: Role; connected: boolean }[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function createRoom(input: {
  hostName: string;
  hostParticipation: HostParticipation;
}): Promise<CreateRoomResponse> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<CreateRoomResponse>(res);
}

export async function joinRoom(
  code: string,
  input: { role: JoinableRole; name: string },
): Promise<JoinRoomResponse> {
  const res = await fetch(`/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<JoinRoomResponse>(res);
}

export async function bootstrapRoom(code: string): Promise<BootstrapResponse> {
  const res = await fetch(`/api/rooms/${code}/bootstrap`);
  return jsonOrThrow<BootstrapResponse>(res);
}
