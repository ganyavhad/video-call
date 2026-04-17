export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  created_at?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}
