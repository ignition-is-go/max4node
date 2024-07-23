import { createSocket, Socket } from 'dgram'
// @ts-ignore
import * as osc from 'osc-min'
import {
  filter,
  finalize,
  firstValueFrom,
  map,
  Observable,
  Subject,
  scan,
  take,
} from 'rxjs'

type Ports = {
  send?: number
  receive?: number
}

type Message = {
  path: string
  property?: string
  value?: any
  method?: string
}

type ObserveArgs = {
  path: string
  property: string
}

type CallArgs = {
  path: string
  method: string
}

type GetArgs = {
  path: string
  property: string
}

type CountArgs = {
  path: string
  property: string
}

type SetArgs = {
  path: string
  property: string
  value: number
}

type ReturnMessageBase = {
  callback: string
  value: any
}

type ReturnMessage =
  | (ReturnMessageBase & {
    is_get_reply: true
  })
  | (ReturnMessageBase & {
    is_observer_reply: true
  })
  | (ReturnMessageBase & {
    is_call_reply: true
  })


type MidiPacket = {
  pitch: number
  velocity: number

  polyKeyPressureKey: number
  polyKeyPressureValue: number

  controlChangeController: number
  controlChangeValue: number

  programChange: number
  afterTouch: number,

  pitchBend: number
  midiChannel: number

}

type DeviceMidiPacket = {
  deviceId: number
} & MidiPacket

export class Max4Node {
  private read: Socket | null = null
  private write: Socket | null = null
  private ports: Ports = {}

  private incomingMessages = new Subject<ReturnMessage>()
  private midiSubject = new Subject<DeviceMidiPacket>()

  private callbacks = new Set<string>()
  private serviceId$ = new Subject<string>()

  // private pathToCallback = new Map<string, Set<string>>();

  public bind(ports: Ports = {}): void {
    ports.send = ports.send || 9000
    ports.receive = ports.receive || 9001
    this.ports = ports
    this.read = this.createInputSocket(ports.receive)
    this.write = createSocket('udp4')
    // this.setupMidiObservable()
  }

  private createInputSocket(port: number): Socket {
    const socket = createSocket('udp4')
    socket.bind(port)
    socket.on('message', (msg) => {
      try {
        this.handleMessage(msg)
      } catch (e) {
        console.error(e)
      }
    })
    return socket
  }

  public watchServiceId() {
    return this.serviceId$.asObservable()
  }

  private handleMessage(msg: Buffer) {
    const obj = osc.fromBuffer(msg)

    if (!obj || !obj.address) {
      console.log('Invalid message:', obj)
      return
    }


    const args = obj.args.map((item: any) => item.value)
    switch (obj.address) {
      case '/_get_reply':
        const get_reply = {
          is_get_reply: true,
          callback: args[0],
          value: args.slice(1),
        } as ReturnMessage
        this.incomingMessages.next(get_reply)
        return
      case '/_observer_reply':
        // console.log(obj)
        if (args[1] === 'id') {
          break
        }

        const obs_reply = {
          is_observer_reply: true,
          callback: args[0],
          value: args.slice(2),
        } as ReturnMessage
        this.incomingMessages.next(obs_reply)
        return
      case '/_call_reply':
        const call_reply = {
          is_call_reply: true,
          callback: args[0],
          value: args.slice(1),
        } as ReturnMessage
        this.incomingMessages.next(call_reply)
        return
      case '/ping':
        this.send_message('pong', obj.args[0].value)
        break
      case '/_service_id':
        // console.log('service id:', obj.args[0].value)
        this.serviceId$.next(obj.args[0].value)
        break
      case '/midi':
        this.handleMidiMessage(args)
        break
      default:
        console.log(obj)
        throw new Error('Unknown message type')
    }
  }

  private handleMidiMessage(args: any[]) {
    const deviceId = args[0]
    const pitch = args[1]
    const velocity = args[2]


    const polyKeyPressureKey = args[3]
    const polyKeyPressureValue = args[4]

    const controlChangeController = args[5]
    const controlChangeValue = args[6]

    const programChange = args[7]
    const afterTouch = args[8]

    const pitchBend = args[9]
    const midiChannel = args[10]


    // console.log('Received MIDI:', args)
    this.midiSubject.next({ pitch, velocity, deviceId, afterTouch, controlChangeController, controlChangeValue, pitchBend, polyKeyPressureKey, polyKeyPressureValue, programChange, midiChannel })
  }

  public getActiveNotesObservable(deviceId: number): Observable<Map<number, MidiPacket>> {
    const activeNotes$ = this.midiSubject.pipe(
      filter((midiMessage) => midiMessage.deviceId === deviceId),
      scan((acc, midiMessage) => {

        const { pitch, velocity } = midiMessage

        if (velocity > 0) {
          acc.set(pitch, midiMessage)
          return acc
        } else {
          acc.delete(pitch)
          return acc
        }
      }, new Map<number, MidiPacket>()),
    )


    return activeNotes$
  }

  public getNoteEventsObservable(deviceId: number): Observable<MidiPacket> {
    return this.midiSubject.pipe(
      filter((midiMessage) => midiMessage.deviceId === deviceId),
    )
  }

  public send_message(address: string, args: any[]): void {
    const buf = osc.toBuffer({
      address: '/' + address,
      args: args,
    })
    this.write!.send(buf, 0, buf.length, this.ports.send!, 'localhost')
  }

  private observerEmitter(msg: Message, action: string): Observable<any> {
    const middle = action === 'call' ? msg.method : msg.property
    const pathHash = `${action} ${msg.path} ${middle}`

    const callback = action === 'observe' ? pathHash : this.callbackHash()
    const args = [msg.path, middle, callback]

    if (!this.callbacks.has(callback)) {
      this.callbacks.add(callback)
      this.send_message(action, args)
    }

    return this.incomingMessages.pipe(
      filter((x) => x.callback === callback),
      map((x) => x.value),
      finalize(() => {
        if (action === 'observe') {
          return
        }
        this.callbacks.delete(callback)
      }),
    )
  }

  private callbackHash(): string {
    return new Date().getTime().toString() + Math.random().toString()
  }

  public get(msg: GetArgs): Promise<any> {
    return firstValueFrom(this.observerEmitter(msg, 'get').pipe(take(1)))
  }

  public set(msg: SetArgs): void {
    const args = [msg.path, msg.property, msg.value]
    this.send_message('set', args)
  }

  public call(msg: CallArgs): Promise<any> {
    return firstValueFrom(this.observerEmitter(msg, 'call').pipe(take(1)))
  }

  public observe(msg: ObserveArgs): Observable<any> {
    return this.observerEmitter(msg, 'observe')
  }

  public count(msg: CountArgs): Observable<any> {
    return this.observerEmitter(msg, 'count')
  }

  public reset(): void {
    this.callbacks.clear()
  }

  public set_field({ field, value }: { field: string; value: any }) {
    this.send_message('set_field', [field, value])
  }
}

export default Max4Node
