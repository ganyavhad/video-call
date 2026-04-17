import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Room, Meeting } from '../models/room.model';

@Injectable({ providedIn: 'root' })
export class RoomService {
  constructor(private http: HttpClient) {}

  createRoom(payload: { name: string; description?: string; maxParticipants?: number }) {
    return this.http.post<Room>(`${environment.apiUrl}/rooms`, payload);
  }

  getMyRooms() {
    return this.http.get<Room[]>(`${environment.apiUrl}/rooms`);
  }

  getRoomByCode(code: string) {
    return this.http.get<Room>(`${environment.apiUrl}/rooms/code/${code}`);
  }

  getRoomById(id: string) {
    return this.http.get<Room>(`${environment.apiUrl}/rooms/${id}`);
  }

  updateRoom(id: string, payload: Partial<Room>) {
    return this.http.put<Room>(`${environment.apiUrl}/rooms/${id}`, payload);
  }

  deleteRoom(id: string) {
    return this.http.delete<{ message: string }>(`${environment.apiUrl}/rooms/${id}`);
  }

  startMeeting(roomId: string) {
    return this.http.post<Meeting>(`${environment.apiUrl}/meetings/start`, { roomId });
  }

  endMeeting(meetingId: string) {
    return this.http.patch<{ message: string; duration: number }>(
      `${environment.apiUrl}/meetings/${meetingId}/end`,
      {}
    );
  }

  getMeetingHistory() {
    return this.http.get<Meeting[]>(`${environment.apiUrl}/meetings/history`);
  }
}
