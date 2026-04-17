import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RoomService } from '../../services/room.service';
import { Room } from '../../models/room.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  user = this.auth.currentUser;
  rooms = signal<Room[]>([]);
  loading = signal(false);
  joinCode = signal('');
  activeTab = signal<'home' | 'rooms' | 'history'>('home');
  showCreateModal = signal(false);
  createError = signal('');

  createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    maxParticipants: [50, [Validators.min(2), Validators.max(200)]],
  });

  constructor(
    private auth: AuthService,
    private roomService: RoomService,
    private fb: FormBuilder,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadRooms();
  }

  loadRooms() {
    this.roomService.getMyRooms().subscribe({
      next: (rooms) => this.rooms.set(rooms),
    });
  }

  startNewMeeting() {
    this.showCreateModal.set(true);
  }

  createRoom() {
    if (this.createForm.invalid) return;
    this.loading.set(true);
    const { name, description, maxParticipants } = this.createForm.getRawValue();

    this.roomService.createRoom({ name, description, maxParticipants }).subscribe({
      next: (room) => {
        this.loading.set(false);
        this.showCreateModal.set(false);
        this.joinRoom(room.id);
      },
      error: (err) => {
        this.createError.set(err.error?.error || 'Failed to create room');
        this.loading.set(false);
      },
    });
  }

  joinByCode() {
    const code = this.joinCode().trim().toUpperCase();
    if (!code) return;
    this.roomService.getRoomByCode(code).subscribe({
      next: (room) => this.joinRoom(room.id),
      error: () => alert('Room not found. Check the code and try again.'),
    });
  }

  joinRoom(roomId: string) {
    this.router.navigate(['/meeting', roomId]);
  }

  deleteRoom(roomId: string) {
    if (!confirm('Delete this room?')) return;
    this.roomService.deleteRoom(roomId).subscribe(() => this.loadRooms());
  }

  logout() {
    this.auth.logout();
  }

  copyCode(code: string) {
    navigator.clipboard.writeText(code);
  }
}
