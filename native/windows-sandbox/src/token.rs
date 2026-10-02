use crate::acl::{add_entries, descriptor, entry, label, sacl, sid};
use crate::objects::SYSTEM_SID;
use crate::win32::{check, Handle, Local, Result};
use std::mem::size_of;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::GENERIC_ALL;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::Cryptography::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::READ_CONTROL;
use windows_sys::Win32::System::SystemServices::SE_GROUP_INTEGRITY;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub(crate) struct Security {
    pub(crate) capability: Local,
    _device: Local,
    pub(crate) everyone: Local,
    pub(crate) owner_rights: Local,
    pub(crate) low_label: Local,
    pub(crate) medium_label: Local,
    pub(crate) user: Vec<u32>,
    pub(crate) token: Handle,
}

impl Security {
    pub(crate) unsafe fn new() -> Result<Self> {
        let mut random = [0u32; 4];
        if BCryptGenRandom(
            null_mut(),
            random.as_mut_ptr().cast(),
            size_of_val(&random) as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        ) < 0
        {
            return Err("sandbox identity generation failed".into());
        }
        let capability = sid(&format!(
            "S-1-5-21-{}-{}-{}-{}",
            random[0], random[1], random[2], random[3]
        ))?;
        let owner_rights = sid("S-1-3-4")?;
        let everyone = sid("S-1-1-0")?;
        let device = sid(SYSTEM_SID)?;
        let integrity_sid = sid("S-1-16-4096")?;
        let low_label = label("S:(ML;OICI;NW;;;LW)")?;
        let medium_label = label("S:(ML;OICI;NW;;;ME)")?;
        let mut original = null_mut();
        check(
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
                &mut original,
            ),
            "token open",
        )?;
        let original = Handle(original);
        let mut needed = 0;
        GetTokenInformation(original.0, TokenUser, null_mut(), 0, &mut needed);
        let mut buffer = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
        check(
            GetTokenInformation(
                original.0,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ),
            "token user inspection",
        )?;
        let user_sid = (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid;
        let length = GetLengthSid(user_sid);
        let mut user = vec![0u32; (length as usize).div_ceil(4)];
        check(
            CopySid(length, user.as_mut_ptr().cast(), user_sid),
            "token user copy",
        )?;
        let restrictions = [capability.0, device.0].map(|principal| SID_AND_ATTRIBUTES {
            Sid: principal,
            Attributes: 0,
        });
        let mut token = null_mut();
        check(
            CreateRestrictedToken(
                original.0,
                DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
                0,
                null(),
                0,
                null(),
                restrictions.len() as u32,
                restrictions.as_ptr(),
                &mut token,
            ),
            "restricted token creation",
        )?;
        let token = Handle(token);
        let mandatory = TOKEN_MANDATORY_LABEL {
            Label: SID_AND_ATTRIBUTES {
                Sid: integrity_sid.0,
                Attributes: SE_GROUP_INTEGRITY as u32,
            },
        };
        check(
            SetTokenInformation(
                token.0,
                TokenIntegrityLevel,
                (&mandatory as *const TOKEN_MANDATORY_LABEL).cast(),
                (size_of::<TOKEN_MANDATORY_LABEL>() as u32) + GetLengthSid(integrity_sid.0),
            ),
            "token integrity initialization",
        )?;
        let disabled = 0u32;
        check(
            SetTokenInformation(
                token.0,
                TokenVirtualizationEnabled,
                (&disabled as *const u32).cast(),
                4,
            ),
            "token virtualization initialization",
        )?;
        let defaults = add_entries(
            &[
                entry(capability.0, GRANT_ACCESS, GENERIC_ALL, 0),
                entry(user.as_mut_ptr().cast(), GRANT_ACCESS, GENERIC_ALL, 0),
                entry(owner_rights.0, GRANT_ACCESS, READ_CONTROL, 0),
            ],
            null_mut(),
        )?;
        let defaults_info = TOKEN_DEFAULT_DACL {
            DefaultDacl: defaults.0.cast(),
        };
        check(
            SetTokenInformation(
                token.0,
                TokenDefaultDacl,
                (&defaults_info as *const TOKEN_DEFAULT_DACL).cast(),
                size_of::<TOKEN_DEFAULT_DACL>() as u32,
            ),
            "token default ACL initialization",
        )?;
        let mut token_descriptor = descriptor(defaults.0.cast(), sacl(low_label.0)?)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: (&mut token_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
            bInheritHandle: 0,
        };
        let mut primary = null_mut();
        check(
            DuplicateTokenEx(
                token.0,
                TOKEN_ALL_ACCESS,
                &attributes,
                SecurityImpersonation,
                TokenPrimary,
                &mut primary,
            ),
            "restricted token security initialization",
        )?;
        let token = Handle(primary);
        Ok(Self {
            capability,
            _device: device,
            everyone,
            owner_rights,
            low_label,
            medium_label,
            user,
            token,
        })
    }
}
