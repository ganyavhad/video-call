import {
  Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Participant } from '../../../models/participant.model';

@Component({
  selector: 'app-participant-tile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="video-tile" [class.video-off]="participant.isVideoOff">
      <video #remoteVideo autoplay playsinline [class.hidden]="participant.isVideoOff"></video>
      <audio #remoteAudio autoplay></audio>

      @if (participant.isVideoOff) {
        <div class="avatar-placeholder">
          {{ participant.displayName?.[0]?.toUpperCase() }}
        </div>
      }

      @if (participant.isScreenSharing) {
        <div class="screen-share-badge">&#128421; Sharing screen</div>
      }

      <div class="tile-info">
        <span class="name">{{ participant.displayName }}</span>
        @if (participant.isMuted) { <span class="mute-icon">&#128263;</span> }
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .video-tile {
      position: relative; aspect-ratio: 16/9;
      background: #1a2035; border-radius: 10px; overflow: hidden;
      border: 2px solid transparent; transition: border-color .2s;
      &:hover { border-color: var(--primary); }
    }
    video { width: 100%; height: 100%; object-fit: cover; &.hidden { display: none; } }
    audio { display: none; }
    .avatar-placeholder {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      font-size: 2.5rem; font-weight: 700;
      background: radial-gradient(circle, #1e3a5f, #0f172a); color: #60a5fa;
    }
    .tile-info {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 6px 10px;
      background: linear-gradient(transparent, rgba(0,0,0,.7));
      display: flex; align-items: center; gap: 8px;
      .name { font-size: .78rem; font-weight: 500; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
    }
    .screen-share-badge {
      position: absolute; top: 8px; left: 8px;
      background: rgba(37,99,235,.8);
      padding: 2px 8px; border-radius: 6px;
      font-size: .72rem; font-weight: 600;
    }
  `],
})
export class ParticipantTileComponent implements OnChanges {
  @Input({ required: true }) participant!: Participant;
  @ViewChild('remoteVideo') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteAudio') audioRef!: ElementRef<HTMLAudioElement>;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['participant']) {
      this.attachStreams();
    }
  }

  private attachStreams() {
    setTimeout(() => {
      if (this.videoRef?.nativeElement && this.participant.videoStream) {
        this.videoRef.nativeElement.srcObject = this.participant.videoStream;
      }
      if (this.audioRef?.nativeElement && this.participant.audioStream) {
        this.audioRef.nativeElement.srcObject = this.participant.audioStream;
      }
    }, 0);
  }
}
