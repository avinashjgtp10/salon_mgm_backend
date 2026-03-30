export type WAUserRole = 'salon_owner' | 'staff' | 'admin'

export type WAUser = {
  id:         string
  first_name: string
  last_name:  string
  email:      string
  role:       WAUserRole
  is_active:  boolean
  created_at: string
}

export type CreateUserBody = {
  first_name: string
  last_name:  string
  email:      string
  password:   string
  role:       WAUserRole
}

export type UpdateUserBody = {
  first_name?: string
  last_name?:  string
  email?:      string
  password?:   string
  role?:       WAUserRole
}
