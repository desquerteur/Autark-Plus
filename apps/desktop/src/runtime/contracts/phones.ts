// Phone use (B-078) as an optional member of RuntimeServices (module augmentation, like the other late additions in this
// folder): whether an Autark app phone is attached right now and whether phone use is on there, and which phones hang off
// this PC at all. Implemented by phone/app-driver.ts AppPhones and the merged driver (phone/drivers.ts), set where the
// device tools are wired (devices/connect.ts). Missing = not wired (fakes, a runtime without devices): a linked phone
// then reads as not connected right now.
// Owns: the member declaration. Never: behaviour.

declare module '../contracts.ts' {
  interface RuntimeServices {
    /** The app phones attached now: 'on' – phone use is on, 'off' – attached with phone use off, undefined – not attached;
     *  `here` – the phones attached to this PC at all (phone/drivers.ts PhonesHere), app phones by device id, ADB phones by serial;
     *  `adbInstalled` – adb is installed on this PC (phone.* can work then, tools/registry.ts). */
    phones?: { useOf(deviceId: string): 'on' | 'off' | undefined; here?(): { app: string[]; adb: string[] }; adbInstalled?(): boolean };
  }
}

export {};
