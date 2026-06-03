import api from '@/lib/api';
import Cookies from 'js-cookie';
import type { User, AuthTokens } from '@/types';

const COOKIE_OPTS = { sameSite: 'strict' as const };

export const authService = {
  register: async (data: { name: string; email: string; password: string }): Promise<AuthTokens> => {
    const res = await api.post<AuthTokens>('/api/v1/auth/register', data);
    return res.data;
  },

  login: async (data: { email: string; password: string }): Promise<AuthTokens> => {
    const res = await api.post<AuthTokens>('/api/v1/auth/login', data);
    Cookies.set('access_token', res.data.access_token, { expires: 1, ...COOKIE_OPTS });
    Cookies.set('refresh_token', res.data.refresh_token, { expires: 7, ...COOKIE_OPTS });
    return res.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/api/v1/auth/logout').catch(() => {});
    Cookies.remove('access_token');
    Cookies.remove('refresh_token');
  },

  me: async (): Promise<User> => {
    const res = await api.get<User>('/api/v1/auth/me');
    return res.data;
  },

  refresh: async (): Promise<AuthTokens> => {
    const refresh_token = Cookies.get('refresh_token');
    const res = await api.post<AuthTokens>('/api/v1/auth/refresh', { refresh_token });
    Cookies.set('access_token', res.data.access_token, { expires: 1, ...COOKIE_OPTS });
    return res.data;
  },

  updateProfile: async (data: Partial<Pick<User, 'name' | 'avatar_url'>>): Promise<User> => {
    const res = await api.patch<User>('/api/v1/auth/me', data);
    return res.data;
  },
};
