import { Injectable, signal } from '@angular/core';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/types';
import { Subject } from 'rxjs';
import { SocketService } from './socket.service';
import { Participant, ChatMessage } from '../models/participant.model';

@Injectable({ providedIn: 'root' })
export class MediasoupService {
  private device!: Device;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();
  private currentRoomId: string | null = null;

  // Reactive signals
  participants = signal<Map<string, Participant>>(new Map());
  chatMessages = signal<ChatMessage[]>([]);
  isConnected = signal(false);
  isMuted = signal(false);
  isVideoOff = signal(false);
  isScreenSharing = signal(false);
  localStream = signal<MediaStream | null>(null);

  // Events
  participantUpdated$ = new Subject<void>();
  chatReceived$ = new Subject<ChatMessage>();
  error$ = new Subject<string>();

  constructor(private socket: SocketService) {}

  async joinRoom(roomId: string, displayName: string): Promise<void> {
    this.currentRoomId = roomId;

    const { rtpCapabilities, roomInfo, error } = await this.socket.emitWithAck<any>('join-room', { roomId });
    if (error) throw new Error(error);

    // Load existing participants
    if (roomInfo?.participants) {
      const map = new Map<string, Participant>();
      for (const p of roomInfo.participants) {
        if (p.socketId !== this.socket.socketId) {
          map.set(p.socketId, { ...p, consumers: new Map() });
        }
      }
      this.participants.set(map);
    }

    // Init mediasoup Device
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    // Create transports
    await this.createSendTransport(roomId);
    await this.createRecvTransport(roomId);

    // Set up socket listeners
    this.setupSocketListeners(roomId);

    // Get already-existing producers and consume them
    const { producers } = await this.socket.emitWithAck<any>('get-producers', { roomId });
    for (const prod of producers) {
      await this.consumeProducer(prod.producerId, prod.peerId);
    }

    this.isConnected.set(true);
  }

  private async createSendTransport(roomId: string): Promise<void> {
    const { params, error } = await this.socket.emitWithAck<any>('create-webrtc-transport', {
      roomId,
      direction: 'send',
    });
    if (error) throw new Error(error);

    this.sendTransport = this.device.createSendTransport(params);

    this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback: (err: Error) => void) => {
      try {
        await this.socket.emitWithAck('connect-transport', {
          roomId,
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (e: any) { errback(e); }
    });

    this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback: (err: Error) => void) => {
      try {
        const { producerId, error: err } = await this.socket.emitWithAck<any>('produce', {
          roomId,
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
          appData,
        });
        if (err) return errback(new Error(err));
        callback({ id: producerId });
      } catch (e: any) { errback(e); }
    });
  }

  private async createRecvTransport(roomId: string): Promise<void> {
    const { params, error } = await this.socket.emitWithAck<any>('create-webrtc-transport', {
      roomId,
      direction: 'recv',
    });
    if (error) throw new Error(error);

    this.recvTransport = this.device.createRecvTransport(params);

    this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback: (err: Error) => void) => {
      try {
        await this.socket.emitWithAck('connect-transport', {
          roomId,
          transportId: this.recvTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (e: any) { errback(e); }
    });
  }

  async publishLocalMedia(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });

    this.localStream.set(stream);

    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    if (audioTrack) {
      const audioProducer = await this.sendTransport!.produce({ track: audioTrack });
      this.producers.set('audio', audioProducer);
    }

    if (videoTrack) {
      const videoProducer = await this.sendTransport!.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000, scaleResolutionDownBy: 4 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 900000 },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
        appData: { type: 'camera' },
      });
      this.producers.set('video', videoProducer);
    }

    return stream;
  }

  async consumeProducer(producerId: string, peerId: string): Promise<void> {
    if (!this.recvTransport) return;

    const response = await this.socket.emitWithAck<any>('consume', {
      roomId: this.currentRoomId,
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    if (response?.error) return;

    const consumer = await this.recvTransport.consume({
      id: response.consumerId,
      producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters,
    });

    this.consumers.set(consumer.id, consumer);

    // Resume consumer
    await this.socket.emitWithAck('resume-consumer', {
      roomId: this.currentRoomId,
      consumerId: consumer.id,
    });

    // Attach track to participant
    const participants = new Map(this.participants());
    let participant = participants.get(peerId) || {
      socketId: peerId,
      userId: peerId,
      displayName: 'Participant',
      isMuted: false,
      isVideoOff: false,
      consumers: new Map(),
    };

    if (!participant.consumers) participant.consumers = new Map();

    if (response.kind === 'audio') {
      const audioStream = new MediaStream([consumer.track]);
      participant = { ...participant, audioStream };
    } else if (response.kind === 'video') {
      const videoStream = new MediaStream([consumer.track]);
      participant = { ...participant, videoStream, stream: videoStream };
    }

    participant.consumers!.set(consumer.id, consumer);
    participants.set(peerId, participant);
    this.participants.set(participants);
    this.participantUpdated$.next();
  }

  async toggleAudio(): Promise<void> {
    const producer = this.producers.get('audio');
    const muted = !this.isMuted();
    if (producer) {
      muted ? producer.pause() : producer.resume();
    }
    this.isMuted.set(muted);
    this.socket.emit('toggle-audio', { roomId: this.currentRoomId, isMuted: muted });
  }

  async toggleVideo(): Promise<void> {
    const producer = this.producers.get('video');
    const videoOff = !this.isVideoOff();
    if (producer) {
      videoOff ? producer.pause() : producer.resume();
    }
    this.isVideoOff.set(videoOff);
    this.socket.emit('toggle-video', { roomId: this.currentRoomId, isVideoOff: videoOff });
  }

  async startScreenShare(): Promise<MediaStream | null> {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      const screenProducer = await this.sendTransport!.produce({
        track,
        appData: { type: 'screen' },
      });
      this.producers.set('screen', screenProducer);
      this.isScreenSharing.set(true);
      this.socket.emit('screen-share-start', { roomId: this.currentRoomId });

      track.onended = () => this.stopScreenShare();
      return stream;
    } catch {
      return null;
    }
  }

  stopScreenShare(): void {
    const producer = this.producers.get('screen');
    if (producer) {
      producer.close();
      this.producers.delete('screen');
    }
    this.isScreenSharing.set(false);
    this.socket.emit('screen-share-stop', { roomId: this.currentRoomId });
  }

  sendChatMessage(message: string, meetingId?: string): void {
    this.socket.emit('chat-message', { roomId: this.currentRoomId, meetingId, message });
  }

  async leaveRoom(): Promise<void> {
    this.socket.emit('leave-room', { roomId: this.currentRoomId });

    // Close local media
    this.localStream()?.getTracks().forEach((t) => t.stop());
    this.producers.forEach((p) => p.close());
    this.consumers.forEach((c) => c.close());
    this.sendTransport?.close();
    this.recvTransport?.close();

    this.producers.clear();
    this.consumers.clear();
    this.participants.set(new Map());
    this.chatMessages.set([]);
    this.localStream.set(null);
    this.isConnected.set(false);
    this.isMuted.set(false);
    this.isVideoOff.set(false);
    this.isScreenSharing.set(false);
    this.currentRoomId = null;
  }

  private setupSocketListeners(roomId: string): void {
    this.socket.on<any>('peer-joined').subscribe((data) => {
      const participants = new Map(this.participants());
      participants.set(data.socketId, {
        socketId: data.socketId,
        userId: data.userId,
        displayName: data.displayName,
        isMuted: false,
        isVideoOff: false,
        consumers: new Map(),
      });
      this.participants.set(participants);
      this.participantUpdated$.next();
    });

    this.socket.on<any>('peer-left').subscribe((data) => {
      const participants = new Map(this.participants());
      participants.delete(data.socketId);
      this.participants.set(participants);
      this.participantUpdated$.next();
    });

    this.socket.on<any>('new-producer').subscribe(async (data) => {
      await this.consumeProducer(data.producerId, data.peerId);
    });

    this.socket.on<any>('consumer-closed').subscribe((data) => {
      this.consumers.delete(data.consumerId);
    });

    this.socket.on<any>('peer-audio-toggled').subscribe((data) => {
      const participants = new Map(this.participants());
      const peer = participants.get(data.socketId);
      if (peer) {
        participants.set(data.socketId, { ...peer, isMuted: data.isMuted });
        this.participants.set(participants);
        this.participantUpdated$.next();
      }
    });

    this.socket.on<any>('peer-video-toggled').subscribe((data) => {
      const participants = new Map(this.participants());
      const peer = participants.get(data.socketId);
      if (peer) {
        participants.set(data.socketId, { ...peer, isVideoOff: data.isVideoOff });
        this.participants.set(participants);
        this.participantUpdated$.next();
      }
    });

    this.socket.on<any>('peer-screen-share-started').subscribe((data) => {
      const participants = new Map(this.participants());
      const peer = participants.get(data.socketId);
      if (peer) {
        participants.set(data.socketId, { ...peer, isScreenSharing: true });
        this.participants.set(participants);
      }
    });

    this.socket.on<any>('peer-screen-share-stopped').subscribe((data) => {
      const participants = new Map(this.participants());
      const peer = participants.get(data.socketId);
      if (peer) {
        participants.set(data.socketId, { ...peer, isScreenSharing: false });
        this.participants.set(participants);
      }
    });

    this.socket.on<ChatMessage>('chat-message').subscribe((msg) => {
      this.chatMessages.update((msgs) => [...msgs, msg]);
      this.chatReceived$.next(msg);
    });

    this.socket.on('kicked').subscribe(() => {
      this.leaveRoom();
    });

    this.socket.on('force-mute').subscribe(() => {
      if (!this.isMuted()) this.toggleAudio();
    });
  }
}
