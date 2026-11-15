// The devices.list tool for agents: this PC and the linked PCs their computer, browser and phone
// tools can run on – name, id, online state, capabilities (adbPhones as that PC announced them)
// and, for an employee's PC, the person it belongs to – plus the agent's home device and, where
// connecting is wired, this PC's Remote ID and the meeting server's state.
// B-080 (live 06./08.11.2026: "online" a minute before every call failed, "connecting" while calls worked): before it
// answers, every linked PC gets one ping, all at once, so `online` means that PC answered just now. A PC without a live
// link is dialed first, as any call does: directly (about 10 s at most), then through the meeting server (about 10 s
// more). The ping itself waits at most the mesh's own probe time (PROBE_MS, 5 s) – a link that still looks open but
// is dead counts as offline then, instead of holding the answer until the keepalive cuts it.
// Owns: devices.list. Never: stores anything.

import { json, type ToolDef } from '../tools/types.ts';
import { defineTool } from '../tools/builtin/util.ts';
import type { DeviceLink } from './connect-tool.ts';
import { PROBE_MS } from './mesh.ts';
import { forwardedHome } from '../tools/placement.ts';

/** The meeting server in one word ('error' retries, so it is still connecting) and why while it is not up. */
function meetingOf(link: DeviceLink): { meetingServer: 'connected' | 'connecting' | 'off'; meetingServerError?: string } {
  const state = link.meeting.state();
  if (state.status === 'connected' || state.status === 'off') return { meetingServer: state.status };
  return { meetingServer: 'connecting', ...(state.error ? { meetingServerError: state.error } : {}) };
}

const DESCRIPTION = "Lists this PC and the linked PCs with state and capabilities. Tools with a device argument run on any of them; without it they run on my home device, with none on this PC.";
/** Said only where devices.connect is registered. */
const LINK_HINT = " This PC's Remote ID and the meeting server come with it; another PC links with devices.connect.";

export function devicesList(link?: DeviceLink): ToolDef {
  return defineTool<Record<string, never>>({
    name: 'devices.list',
    description: link ? DESCRIPTION + LINK_HINT : DESCRIPTION,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    category: 'read',
    describe: () => ({ summary: 'List linked PCs', reversible: true, external: false }),
    async run(_args, ctx) {
      const service = ctx.services.devices;
      const self = service.self();
      // Phones and browsers with the app are the person's screens, not places where tools run.
      const linked = () => service.list().filter((device) => device.kind === 'pc' && device.status !== 'revoked');
      const answered = new Set<string>();
      await Promise.all(linked().filter((device) => !device.self && device.id !== self.id).map((device) =>
        service.call(device.id, 'ping', null, ctx.signal, PROBE_MS).then(() => { answered.add(device.id); }, () => undefined)));
      const pcs = linked(); // after the pings: status and last-seen as they are now
      // B-080: the home my calls really go to without device (tools/placement.ts) – none when they run here
      const home = ctx.agent.deviceId && ctx.agent.deviceId !== self.id ? forwardedHome(ctx.services, ctx.agent.deviceId) : undefined;
      return json({
        youAreOn: self.name,
        ...(link ? { remoteId: link.remote.remoteId(), ...meetingOf(link) } : {}),
        ...(home ? { homeDevice: home.name, note: `Without device, my device tools run on ${home.name}.` } : {}),
        devices: pcs.map((device) => {
          const thisPc = device.self || device.id === self.id;
          const online = thisPc || answered.has(device.id);
          return {
            id: device.id, name: device.name, ...(thisPc ? { thisPc: true } : {}), online, ...(online ? {} : { status: device.status === 'online' ? 'offline' : device.status }), caps: device.caps,
            ...(device.personId ? { employeeOf: device.personId } : {}),
            ...(!thisPc && device.lastSeenAt ? { lastSeen: new Date(device.lastSeenAt).toISOString() } : {}),
          };
        }),
      });
    },
  });
}
