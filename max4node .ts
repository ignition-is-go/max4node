import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'events';
import * as osc from 'osc-min';
import { resolve as pathResolve } from 'path';
import { firstValueFrom, Observable, ReplaySubject, Subject, take } from 'rxjs';

type Ports = {
  send?: number;
  receive?: number;
};

type Message = {
  path: string;
  property?: string;
  value?: any;
  method?: string;
};

export class Max4Node {
  private read: Socket | null = null;
  private write: Socket | null = null;
  private ports: Ports = {};
  private emitters: Record<string, Subject<any>> = {};
  private promisedFn?: {
    get: typeof promiseMessage;
    count: typeof promiseMessage;
  };
  private callReturns: Record<string, (value: any) => void> = {};

  public bind(ports: Ports = {}): void {
    ports.send = ports.send || 9000;
    ports.receive = ports.receive || 9001;
    this.ports = ports;
    this.read = this.createInputSocket(ports.receive);
    this.write = createSocket('udp4');
  }

  private createInputSocket(port: number): Socket {
    const socket = createSocket('udp4');
    socket.bind(port);
    socket.on('message', (msg, rinfo) => {
      const obj = this.parseMessage(msg);
      if (obj.is_get_reply || obj.is_observer_reply) {
        try {
          this.emitters[obj.callback].next(obj.value);
        } catch (err) {
          console.error(err);
        }
      }
      if (obj.is_get_reply) {
        delete this.emitters[obj.callback];
      }
      if (obj.is_call_reply) {
        this.callReturns[obj.callback](obj.value);
        delete this.callReturns[obj.callback];
      }
    });
    return socket;
  }

  private parseMessage(msg: Buffer): any {
    const obj = osc.fromBuffer(msg);
    const args = obj.args.map((item: any) => item.value);
    // console.log('parseMessage', obj);
    switch (obj.address) {
      case '/_get_reply':
        obj.is_get_reply = true;
        obj.callback = args[0];
        obj.value = args[1];
        break;
      case '/_observer_reply':
        obj.is_observer_reply = true;
        obj.callback = args[0];
        obj.value = args.slice(2);
        break;
      case '/_call_reply':
        obj.is_call_reply = true;
        obj.callback = args[0];
        obj.value = args.slice(1);
        break;
    }
    return obj;
  }

  public send_message(address: string, args: any[]): void {
    const buf = osc.toBuffer({
      address: '/' + address,
      args: args,
    });
    this.write!.send(buf, 0, buf.length, this.ports.send!, 'localhost');
  }

  private observerEmitter(
    msg: Message,
    action: string = 'observe',
  ): Observable<any> {
    const emitter = new ReplaySubject(1);
    const callback = this.callbackHash();
    this.emitters[callback] = emitter;
    const args = [msg.path, msg.property, callback];
    this.send_message(action, args);
    return emitter;
  }

  private callbackHash(): string {
    return new Date().getTime().toString() + Math.random().toString();
  }

  public get(msg: Message): Promise<any> {
    return firstValueFrom(this.observerEmitter(msg, 'get').pipe(take(1)));
  }

  public set(msg: Message): void {
    const args = [msg.path, msg.property, msg.value];
    this.send_message('set', args);
  }

  public call(msg: Message, timeout = 500): Promise<any> {
    const id = this.callbackHash();
    const args = [msg.path, msg.method, id];
    this.send_message('call', args);
    return new Promise((resolve, reject) => {
      const t = setTimeout(reject, timeout);
      this.callReturns[id] = (v) => {
        clearTimeout(t);
        resolve(v);
      };
    });
  }

  public observe(msg: Message): Observable<any> {
    return this.observerEmitter(msg, 'observe');
  }

  public count(msg: Message): Observable<any> {
    return this.observerEmitter(msg, 'count');
  }

  public promise(): {
    get: typeof promiseMessage;
    count: typeof promiseMessage;
  } {
    if (this.promisedFn) {
      return this.promisedFn;
    }
    return (this.promisedFn = {
      get: promiseMessage.bind(this, 'get'),
      count: promiseMessage.bind(this, 'count'),
    });
  }
}

function promiseMessage(
  this: Max4Node,
  method: 'get' | 'count',
  msg: Message,
): Promise<any> {
  const emitter = this[method](msg);
  if (emitter instanceof Promise) {
    return emitter;
  }
  return firstValueFrom(emitter);
}

export default Max4Node;
