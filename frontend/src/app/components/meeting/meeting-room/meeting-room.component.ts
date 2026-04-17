import {
  Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { SocketService } from '../../../services/socket.service';
import { MediasoupService } from '../../../services/mediasoup.service';
import { RoomService } from '../../../services/room.service';
import { Room } from '../../../models/room.model';
import { Participant } from '../../../models/participant.model';
import { ParticipantTileComponent } from '../participant-tile/participant-tile.component';

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule, FormsModule, ParticipantTileComponent],
  templateUrl: './meeting-room.component.html',
  styleUrls: ['./meeting-room.component.scss'],
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;

  room = signal<Room | null>(null);
  meetingId = signal<string | null>(null);
  joining = signal(true);
  error = signal('');
  showChat = signal(false);
  showParticipants = signal(false);
  chatInput = '';
  elapsedTime = signal('00:00');

  user = this.auth.currentUser;

  // From mediasoup service
  participants = this.ms.participants;
  chatMessages = this.ms.chatMessages;
  isMuted = this.ms.isMuted;
  isVideoOff = this.ms.isVideoOff;
  isScreenSharing = this.ms.isScreenSharing;

  participantList = computed(() =>
    Array.from(this.participants().values())
  );

  unreadCount = signal(0);
  private lastReadCount = 0;
  private timerInterval: any;
  private startTime = Date.now();
  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private socket: SocketService,
    private ms: MediasoupService,
    private roomService: RoomService
  ) {}

  async ngOnInit() {
    const roomId = this.route.snapshot.paramMap.get('roomId')!;

    try {
      // Load room info
      const room = await this.roomService.getRoomById(roomId).toPromise();
      this.room.set(room!);

      // Connect socket
      this.socket.connect();

      // Start meeting session in DB
      const meeting = await this.roomService.startMeeting(roomId).toPromise();
      this.meetingId.set(meeting?.id || null);

      // Join mediasoup room
      await this.ms.joinRoom(roomId, this.user()?.name || 'Guest');

      // Publish local media
      const stream = await this.ms.publishLocalMedia();
      this.setLocalVideo(stream);

      // Start timer
      this.startTimer();
      this.joining.set(false);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to join meeting');
      this.joining.set(false);
    }

    // Track unread chat
    this.subs.add(
      this.ms.chatReceived$.subscribe(() => {
        if (!this.showChat()) {
          this.unreadCount.update((n) => n + 1);
        }
      })
    );
  }

  private setLocalVideo(stream: MediaStream) {
    // Small delay to allow viewchild to render
    setTimeout(() => {
      if (this.localVideoRef?.nativeElement) {
        this.localVideoRef.nativeElement.srcObject = stream;
      }
    }, 100);
  }

  async toggleAudio() {
    await this.ms.toggleAudio();
  }

  async toggleVideo() {
    await this.ms.toggleVideo();
    if (!this.isVideoOff() && this.localVideoRef?.nativeElement) {
      const stream = this.ms.localStream();
      if (stream) this.localVideoRef.nativeElement.srcObject = stream;
    }
  }

  async toggleScreenShare() {
    if (this.isScreenSharing()) {
      this.ms.stopScreenShare();
    } else {
      await this.ms.startScreenShare();
    }
  }

  sendChat() {
    if (!this.chatInput.trim()) return;
    this.ms.sendChatMessage(this.chatInput.trim(), this.meetingId() || undefined);
    this.chatInput = '';
  }

  toggleChat() {
    this.showChat.update((v) => !v);
    if (this.showChat()) {
      this.unreadCount.set(0);
      this.lastReadCount = this.chatMessages().length;
    }
  }

  async leaveMeeting() {
    clearInterval(this.timerInterval);
    await this.ms.leaveRoom();

    if (this.meetingId()) {
      this.roomService.endMeeting(this.meetingId()!).subscribe();
    }

    this.socket.disconnect();
    this.router.navigate(['/home']);
  }

  private startTimer() {
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      this.elapsedTime.set(h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`);
    }, 1000);
  }

  ngOnDestroy() {
    clearInterval(this.timerInterval);
    this.subs.unsubscribe();
    this.ms.leaveRoom();
  }
}
