/*
 * مكتبة العيسائي القانونية الرقمية (PWA) - ملف الوظائف الرئيسي
 * الإصدار المدمج والنهائي: أمان مُعزز (تشفير كلمة المرور) وتحسينات UX
 */

// ----------------------------------------------------
// 1. المتغيرات الأساسية وقاعدة البيانات (IndexedDB)
// ----------------------------------------------------

let meta = {
    password: null, // سيتم تخزين الهاش والـ Salt هنا: { hash: '...', salt: '...' }
    types: [
        { id: 't1', icon: '⚖️', name: 'قانون العمل', color: '#d4af37', items: [
            { id: 't1-i1', name: 'الفصل الأول', content: '', files: [], children: [
                { id: 't1-i1-s1', name: 'المادة 1', content: 'نص المادة الأولى من قانون العمل.', files: [] }
            ]}
        ]}
    ],
    uploads: []
};

const DB_NAME = 'AysaeiLibraryDB_Final';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const UPLOAD_STORE = 'uploads';
let db;

// متغيرات الأمان
const HASH_ITERATIONS = 100000;
const HASH_ALGORITHM = 'SHA-256';
const ADMIN_SESSION_KEY = 'admin_session_active'; // مفتاح جلسة الدخول

// مفاتيح التخزين
const META_KEY = 'maktabat_alaysaei_meta_final';
const ADMIN_PW_KEY = 'admin_password_hash';

// العناصر الأساسية للواجهة
const searchInput = document.getElementById('search');
const publicIndex = document.getElementById('public-index');
const viewerContent = document.getElementById('viewer-content');
const itemTitle = document.getElementById('item-title');
const itemSubtitle = document.getElementById('item-subtitle');
const attachmentsSection = document.getElementById('attachments-section');
const attachmentsList = document.getElementById('attachments-list');

// عناصر المودال
const passwordModal = document.getElementById('password-modal');
const adminModal = document.getElementById('admin-modal');
const editorModal = document.getElementById('editor-modal');
const viewAttachmentsModal = document.getElementById('view-attachments-modal');
const uploadsModal = document.getElementById('uploads-modal');
const itemEditor = document.getElementById('item-editor');
const itemEditorTitle = document.getElementById('item-editor-title');

// العناصر الجديدة للتحرير من داخل لوحة الإدارة
const btnShowIndexManager = document.getElementById('btn-show-index-manager');
const contentManagerArea = document.getElementById('content-manager-area');
const editableIndex = document.getElementById('editable-index');


// ----------------------------------------------------
// 2. وظائف قاعدة البيانات الأساسية (IndexedDB Helpers)
// ----------------------------------------------------

function openDB() {
    return new Promise((res, rej) => {
        const rq = indexedDB.open(DB_NAME, DB_VERSION);
        rq.onupgradeneeded = (e) => {
            db = e.target.result;
            // متجر لملفات المرفقات (ملفات كبيرة)
            if (!db.objectStoreNames.contains(FILE_STORE)) {
                db.createObjectStore(FILE_STORE, { keyPath: 'id' });
            }
            // متجر لرسائل التواصل (uploads)
            if (!db.objectStoreNames.contains(UPLOAD_STORE)) {
                db.createObjectStore(UPLOAD_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        rq.onsuccess = (e) => {
            db = e.target.result;
            res(db);
        };
        rq.onerror = (e) => rej(e.target.error);
    });
}

function getObjectStore(storeName, mode) {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

function saveFile(id, file) {
    return new Promise(async (res, rej) => {
        const store = getObjectStore(FILE_STORE, 'readwrite');
        const rq = store.put({ id: id, data: file, type: file.type });
        rq.onsuccess = () => res(true);
        rq.onerror = (e) => rej(e.target.error);
    });
}

function getFile(id) {
    return new Promise((res, rej) => {
        const store = getObjectStore(FILE_STORE, 'readonly');
        const rq = store.get(id);
        rq.onsuccess = (e) => res(e.target.result ? e.target.result.data : null);
        rq.onerror = (e) => rej(e.target.error);
    });
}

function saveUpload(uploadData) {
    return new Promise((res, rej) => {
        const store = getObjectStore(UPLOAD_STORE, 'readwrite');
        const rq = store.add(uploadData);
        rq.onsuccess = (e) => res(e.target.result); // إرجاع المفتاح الذي تم إضافته (id)
        rq.onerror = (e) => rej(e.target.error);
    });
}

function getAllUploads() {
    return new Promise((res, rej) => {
        const store = getObjectStore(UPLOAD_STORE, 'readonly');
        const rq = store.getAll();
        rq.onsuccess = (e) => res(e.target.result);
        rq.onerror = (e) => rej(e.target.error);
    });
}

function clearUploads() {
    return new Promise((res, rej) => {
        const store = getObjectStore(UPLOAD_STORE, 'readwrite');
        const rq = store.clear();
        rq.onsuccess = () => res(true);
        rq.onerror = (e) => rej(e.target.error);
    });
}


// ----------------------------------------------------
// 3. وظائف الأمان والتشفير (PBKDF2)
// ----------------------------------------------------

// تحويل سلسلة نصية إلى Buffer
function str2buf(str) {
    return new TextEncoder().encode(str);
}

// توليد Salt عشوائي
function generateSalt(length = 16) {
    return window.crypto.getRandomValues(new Uint8Array(length));
}

// تحويل Buffer إلى سلسلة نصية Base64
function buf2b64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}

// تحويل سلسلة نصية Base64 إلى Buffer (تم التعديل)
function b642buf(b64) {
    // تحويل سلسلة Base64 إلى Uint8Array سليمة (الحل الصحيح للتعامل مع بايتات ثنائية)
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// اشتقاق مفتاح (Hashing) باستخدام PBKDF2
async function hashPassword(password, salt) {
    const key = await crypto.subtle.importKey(
        "raw",
        str2buf(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const hash = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: HASH_ITERATIONS,
            hash: HASH_ALGORITHM,
        },
        key,
        256 // طول الـ Hash بـ Bits
    );
    return buf2b64(hash);
}

// التحقق من كلمة المرور
async function verifyPassword(password) {
    if (!meta.password || !meta.password.hash || !meta.password.salt) return false;

    const storedHash = meta.password.hash;
    const salt = b642buf(meta.password.salt); // استخدام الدالة المحدثة
    const newHash = await hashPassword(password, salt);

    // التحقق من التساوي الآمن (لمنع هجمات التوقيت)
    return newHash === storedHash;
}


// ----------------------------------------------------
// 4. وظائف البيانات الأساسية (Meta & State)
// ----------------------------------------------------

function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function loadMeta() {
    const data = localStorage.getItem(META_KEY);
    if (data) {
        meta = JSON.parse(data);
    }
}

// التأكد من وجود بيانات افتراضية إذا كان التخزين فارغاً
function ensureDefaults() {
    loadMeta();
    if (meta.types.length === 0) {
        // إعادة تعيين إلى القيمة الافتراضية
        meta = {
            password: null,
            types: [
                { id: 't1', icon: '⚖️', name: 'قانون العمل', color: '#d4af37', items: [
                    { id: 't1-i1', name: 'الفصل الأول', content: '<h2>نص قانوني</h2><p>هذه هي المادة الأولى. يمكنك تعديلها وحذفها.</p>', files: [], children: [] }
                ]}
            ],
            uploads: []
        };
        saveMeta();
    }
}

// جلب عنصر الفهرس (المادة أو التصنيف) باستخدام ID
function getItemById(id, currentItems = meta.types) {
    for (const item of currentItems) {
        if (item.id === id) return item;
        if (item.items && item.items.length > 0) {
            const found = getItemById(id, item.items);
            if (found) return found;
        }
        if (item.children && item.children.length > 0) {
            const found = getItemById(id, item.children);
            if (found) return found;
        }
    }
    return null;
}

// ----------------------------------------------------
// 5. وظائف العرض والرندر (Rendering)
// ----------------------------------------------------

// عرض رسالة عائمة
function showMessage(text, type = 'neutral') {
    const container = document.getElementById('message-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerText = text;

    container.appendChild(messageDiv);
    
    // إظهار الرسالة بتأثير
    setTimeout(() => {
        messageDiv.classList.add('show');
    }, 10);

    // إخفاء وحذف الرسالة بعد 3 ثواني
    setTimeout(() => {
        messageDiv.classList.remove('show');
        setTimeout(() => {
            messageDiv.remove();
        }, 300); // إزالة بعد انتهاء الانتقال
    }, 3000);
}

// عرض شريط الأيقونات العلوي
function renderTopStrip() {
    const stripInner = document.getElementById('top-icons');
    stripInner.innerHTML = '';
    meta.types.forEach(type => {
        const div = document.createElement('div');
        div.className = 'item';
        div.id = `type-${type.id}`;
        div.innerHTML = `<div class="icon">${type.icon}</div><div class="label">${type.name}</div>`;
        div.onclick = () => openType(type.id);
        stripInner.appendChild(div);
    });
}

// عرض الفهرس العام (مع مراعاة البحث)
function renderPublicIndex(activeItemId = null) {
    publicIndex.innerHTML = '';
    const searchTerm = searchInput.value.toLowerCase();
    
    let isSearchMode = searchTerm.length > 0;

    meta.types.forEach(type => {
        const typeEl = document.createElement('div');
        typeEl.className = 'index-group-name';
        typeEl.innerText = `${type.icon} ${type.name}`;
        typeEl.onclick = () => openType(type.id);
        publicIndex.appendChild(typeEl);
        
        // عرض العناصر الفرعية للتصنيف
        const renderItems = (items, parentId) => {
            items.forEach(item => {
                const itemMatches = item.name.toLowerCase().includes(searchTerm) || 
                                    item.content.toLowerCase().includes(searchTerm);
                
                // إذا لم يكن وضع بحث، أو كان وضع بحث والعنصر يطابق
                if (!isSearchMode || itemMatches) {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'index-item';
                    itemEl.classList.toggle('active', item.id === activeItemId);
                    // تم حذف النقاط الثلاث (...) وقائمة السياق من هنا
                    itemEl.innerHTML = `<span>${item.name}</span>`; 
                    itemEl.onclick = (e) => {
                        openItem(item.id);
                    };
                    publicIndex.appendChild(itemEl);
                }

                // نمرر للأسفل حتى في وضع البحث للسماح بـ "المطابقة في المحتوى" للأبناء بالظهور
                if (item.children && item.children.length > 0) {
                    renderItems(item.children, item.id);
                }
            });
        };
        
        renderItems(type.items, type.id);
    });

    // تم حذف مستمعي الأحداث لزر القائمة (dots)
}

// فتح تصنيف (Type) وعرض عناصره
function openType(typeId) {
    document.querySelectorAll('.strip-inner .item').forEach(el => el.classList.remove('active'));
    document.getElementById(`type-${typeId}`).classList.add('active');

    // لا نعيد رندر الفهرس، فقط نعيد تركيزه على التصنيف (لو كان هناك فلاتر)
    // renderPublicIndex(); 

    // يمكن إضافة منطق هنا لإظهار/إخفاء عناصر حسب التصنيف لو كان الفهرس أكبر
    showMessage(`تم تحديد التصنيف: ${getItemById(typeId).name}`, 'neutral');
}

// عرض محتوى المادة/المثال المحدد
function openItem(itemId) {
    const item = getItemById(itemId);
    if (!item) {
        viewerContent.innerHTML = `<p style="text-align:center;color:#e57373;">المادة المطلوبة غير موجودة.</p>`;
        itemTitle.innerText = 'خطأ';
        itemSubtitle.innerText = '';
        attachmentsSection.style.display = 'none';
        return;
    }

    // تحديث الفهرس لإظهار العنصر النشط
    renderPublicIndex(itemId);

    itemTitle.innerText = item.name;
    // يمكن هنا عرض اسم التصنيف الأم
    const parent = getItemById(item.parentId || 'N/A'); 
    itemSubtitle.innerText = item.parentId ? `التصنيف الأم: ${parent ? parent.name : 'غير محدد'}` : ''; 
    viewerContent.innerHTML = item.content;
    viewerContent.dataset.itemId = itemId; // لتخزينه للاستخدام في وظائف النسخ/الطباعة

    // عرض المرفقات
    renderAttachments(item.files);
}

// عرض قائمة المرفقات
function renderAttachments(files) {
    if (!files || files.length === 0) {
        attachmentsSection.style.display = 'none';
        attachmentsList.innerHTML = '';
        return;
    }

    attachmentsSection.style.display = 'block';
    attachmentsList.innerHTML = '';

    files.forEach(file => {
        const tag = document.createElement('a');
        tag.className = 'attachment-tag';
        tag.href = '#'; // سيتم تحميله عند النقر
        tag.innerText = `📎 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        tag.title = `انقر لتنزيل ${file.name}`;
        
        tag.onclick = async (e) => {
            e.preventDefault();
            showMessage(`جاري تحميل الملف: ${file.name}`, 'neutral');
            const blob = await getFile(file.id);
            if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showMessage(`تم تنزيل الملف: ${file.name}`, 'success');
            } else {
                showMessage(`خطأ في تحميل الملف: ${file.name}`, 'error');
            }
        };
        attachmentsList.appendChild(tag);
    });
}


// ----------------------------------------------------
// 6. وظائف قائمة السياق (تم حذفها والاستبدال بلوحة التحرير)
// ----------------------------------------------------

// تم حذف المتغيرات والدوال الخاصة بقائمة السياق (hideMenu, showContextMenu)


// ----------------------------------------------------
// 7. وظائف التحرير والإدارة
// ----------------------------------------------------

let currentEditId = null;
let isAdding = false;
let currentParentId = null;
let currentType = null; // لتخزين نوع العنصر للتعديل (Type, Item, Child)

// فتح محرر النصوص (المودال)
function openEditorModal(title, content) {
    itemEditorTitle.value = title;
    itemEditor.innerHTML = content;
    editorModal.classList.add('show');
}

// إغلاق محرر النصوص
document.getElementById('editor-close').onclick = () => {
    editorModal.classList.remove('show');
    currentEditId = null;
    isAdding = false;
    currentParentId = null;
    currentType = null;
    document.getElementById('btn-delete-item').style.display = 'block'; // إظهار زر الحذف عند الإغلاق
    renderEditableIndex(); // تحديث الفهرس القابل للتحرير بعد الحفظ/الإغلاق
};

// وظيفة التعديل
function editItem(id) {
    currentEditId = id;
    isAdding = false;
    const item = getItemById(id);
    if (!item) return showMessage('العنصر غير موجود.', 'error');

    // لتحديد هل هو تصنيف، مادة، أو مادة فرعية (لتحديد مكان حفظه)
    currentType = item.items ? 'Type' : (item.children ? 'Item' : 'Child');

    openEditorModal(item.name, item.content || '');
    
    // إخفاء زر الحذف في المحرر للعناصر الرئيسية (مثل التصنيفات)
    document.getElementById('btn-delete-item').style.display = item.items ? 'none' : 'block';
    document.getElementById('btn-attach-files').style.display = 'block';
    document.getElementById('btn-view-attachments').style.display = 'block';

    // عرض المرفقات في لوحة التعديل
    renderAttachmentsEdit(item.files || []);
}

// وظيفة الإضافة (الأخ/الابن)
function addItem(parentId, isChild) {
    isAdding = true;
    currentParentId = parentId;
    currentType = isChild ? 'Child' : 'Item'; // يتم تحديدها حسب الحاجة

    // نحدد اسم التصنيف/المادة الأم
    const parentItem = getItemById(parentId);
    if (!parentItem) return showMessage('القسم الأم غير موجود.', 'error');

    const newName = isChild ? 'قسم فرعي جديد' : 'مادة جديدة';
    const newContent = '<h2>عنوان المادة</h2><p>اكتب هنا محتوى المادة/القسم الجديد.</p>';
    
    openEditorModal(newName, newContent);
    currentEditId = `temp-${Date.now()}`; // ID مؤقت
    document.getElementById('btn-delete-item').style.display = 'none'; // لا يمكن حذف عنصر جديد
    document.getElementById('btn-attach-files').style.display = 'none'; // لا يمكن إرفاق ملفات قبل الحفظ لأول مرة
    document.getElementById('btn-view-attachments').style.display = 'none';
}

// وظيفة الحفظ
document.getElementById('editor-save').onclick = async () => {
    const title = itemEditorTitle.value.trim();
    const content = itemEditor.innerHTML.trim();

    if (!title) {
        return showMessage('الرجاء إدخال عنوان.', 'error');
    }

    if (isAdding) {
        // --- إضافة عنصر جديد ---
        const newItem = {
            id: currentEditId,
            name: title,
            content: content,
            files: [],
            // نضيف حقل الأبناء فقط للعناصر التي تعتبر فئات عليا أو مواد (وليس أقسام فرعية)
            ...(currentType === 'Item' && { children: [] }) 
        };

        const parent = getItemById(currentParentId);
        if (!parent) return showMessage('خطأ في تحديد القسم الأم.', 'error');

        // تحديد قائمة الإضافة
        const targetList = (parent.children && currentType === 'Child') ? parent.children : parent.items;

        if (targetList) {
             // إزالة الـ id المؤقت قبل الإضافة
            delete newItem.id;
            newItem.id = (currentType === 'Item') ? `i${Date.now()}` : `c${Date.now()}`; // id للعنصر أو الابن
            targetList.push(newItem);
            currentEditId = newItem.id; // تحديث الـ ID لفتحه وعرضه
            
            showMessage(`تمت إضافة "${title}" بنجاح.`, 'success');
        } else {
            return showMessage('تعذر إضافة العنصر. التحقق من الهيكل.', 'error');
        }

    } else {
        // --- تعديل عنصر موجود ---
        const item = getItemById(currentEditId);
        if (!item) return showMessage('خطأ: العنصر غير موجود.', 'error');

        item.name = title;
        item.content = content;
        showMessage(`تم تعديل "${title}" بنجاح.`, 'success');
    }

    saveMeta();
    renderPublicIndex(currentEditId);
    openItem(currentEditId);
    document.getElementById('editor-close').click(); // إغلاق المودال
};

// وظيفة حذف عنصر
function deleteItemConfirmation(id, parentId) {
    const item = getItemById(id);
    if (!item) return;

    if (confirm(`هل أنت متأكد من حذف "${item.name}"؟ سيؤدي هذا إلى حذف كل محتوياته ومرفقاته.`)) {
        deleteItem(id, parentId);
    }
}

function deleteItem(id, parentId) {
    const parent = getItemById(parentId || id); // في حالة التصنيف (Type) لا يوجد parentId

    if (!parent) return showMessage('خطأ: تعذر العثور على القسم الأم.', 'error');

    let targetList = parent.items || parent.children;
    if (parent.items && !parentId) { // إذا كان تصنيف (Type)، نحذف من القائمة الرئيسية
        targetList = meta.types;
    }


    if (targetList) {
        const index = targetList.findIndex(i => i.id === id);
        if (index !== -1) {
            const deletedItem = targetList.splice(index, 1)[0];
            
            // ... (منطق حذف الملفات المرفقة من IndexedDB يُترك حالياً) ...
            
            saveMeta();
            renderPublicIndex();
            renderEditableIndex(); // تحديث قائمة التحرير
            // مسح العارض
            viewerContent.innerHTML = `<p style="text-align:center;color:#5d5d5d;padding-top:20px;">تم حذف المادة "${deletedItem.name}". الرجاء اختيار قسم آخر.</p>`;
            itemTitle.innerText = '';
            showMessage(`تم حذف "${deletedItem.name}" بنجاح.`, 'success');
            document.getElementById('editor-close').click(); // إغلاق المحرر إذا كان مفتوحاً
            return;
        }
    }
    
    showMessage('خطأ في عملية الحذف. العنصر غير موجود في القائمة الأم.', 'error');
}

// ----------------------------------------------------
// 8. وظائف لوحة تحرير الفهرس الجديدة
// ----------------------------------------------------

function renderEditableIndex() {
    editableIndex.innerHTML = '';
    
    // دالة مساعدة لتوليد زر
    const createButton = (text, className, onClick, title = '') => {
        const btn = document.createElement('button');
        btn.className = `btn ${className} small`;
        btn.innerText = text;
        btn.title = title || text;
        btn.onclick = onClick;
        return btn;
    };
    
    // دالة مساعدة لإنشاء حاوية الإجراءات
    const createActionsDiv = () => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '5px';
        return div;
    };

    // الدالة التكرارية لعرض العناصر
    const renderItems = (items, parentId, level = 0) => {
        items.forEach(item => {
            const isItem = item.children && Array.isArray(item.children); // مادة رئيسية
            const isChild = !isItem && !!item.content; // قسم فرعي
            
            const itemEl = document.createElement('div');
            itemEl.className = 'editable-item';
            itemEl.style.paddingRight = `${level * 15}px`;
            itemEl.style.marginBottom = '5px';
            itemEl.style.borderRight = isItem ? '1px solid var(--accent)' : 'none';
            itemEl.style.padding = '8px 8px';
            itemEl.style.backgroundColor = isItem ? '#1a1816' : 'transparent';
            itemEl.style.borderRadius = '5px';
            itemEl.style.display = 'flex';
            itemEl.style.justifyContent = 'space-between';
            itemEl.style.alignItems = 'center';
            
            const nameSpan = document.createElement('span');
            nameSpan.style.color = 'var(--muted)';
            nameSpan.innerText = item.name;

            const actionsDiv = createActionsDiv();
            
            // 1. زر التعديل (لكل العناصر)
            actionsDiv.appendChild(createButton('✏️', 'neutral', () => editItem(item.id), 'تعديل المحتوى'));
            
            // 2. زر إضافة ابن (للمادة الرئيسية فقط)
            if (isItem) {
                actionsDiv.appendChild(createButton('➕', 'primary', () => addItem(item.id, true), 'إضافة قسم فرعي'));
            }
            
            // 3. زر الحذف (لكل العناصر)
            const btnDelete = createButton('🗑️', 'neutral', () => deleteItemConfirmation(item.id, parentId), 'حذف العنصر');
            btnDelete.style.color = 'var(--error)';
            actionsDiv.appendChild(btnDelete);

            itemEl.appendChild(nameSpan);
            itemEl.appendChild(actionsDiv);
            editableIndex.appendChild(itemEl);

            // تكرار للأبناء (أقسام فرعية)
            if (isItem && item.children) {
                renderItems(item.children, item.id, level + 1);
            }
        });
    };
    
    // البدء بعرض التصنيفات الرئيسية
    meta.types.forEach(type => {
        
        // عنوان التصنيف
        const typeEl = document.createElement('div');
        typeEl.className = 'editable-type-header';
        typeEl.style.fontWeight = 'bold';
        typeEl.style.color = 'var(--accent)';
        typeEl.style.padding = '10px 0';
        typeEl.style.marginTop = '15px';
        typeEl.style.borderBottom = '1px dashed var(--line)';
        typeEl.style.display = 'flex';
        typeEl.style.justifyContent = 'space-between';
        
        const nameSpan = document.createElement('span');
        nameSpan.innerText = `${type.icon} ${type.name} (تصنيف رئيسي)`;
        typeEl.appendChild(nameSpan);

        const actionsDiv = createActionsDiv();
        
        // إضافة زر تعديل اسم التصنيف (يستخدم دالة editType الموجودة)
        actionsDiv.appendChild(createButton('✏️ تعديل الاسم', 'neutral', () => editType(type.id)));

        // إضافة زر إضافة مادة رئيسية
        actionsDiv.appendChild(createButton('➕ إضافة مادة', 'primary', () => addItem(type.id, false)));

        typeEl.appendChild(actionsDiv);
        editableIndex.appendChild(typeEl);

        // عرض المواد الرئيسية داخل التصنيف
        renderItems(type.items, type.id, 0); 
    });
    
    // رسالة إذا كان الفهرس فارغاً
    if (meta.types.length === 0) {
        editableIndex.innerHTML = '<p style="text-align:center;color:var(--error)">لا يوجد محتوى في الفهرس لعرضه.</p>';
    }
}


// ----------------------------------------------------
// 9. وظائف إدارة الملفات والمرفقات في المحرر
// ----------------------------------------------------

let currentAttachments = []; // قائمة الملفات المؤقتة التي سيتم إرفاقها

// عرض قائمة المرفقات في وضع التعديل
function renderAttachmentsEdit(files) {
    currentAttachments = files;
    const list = document.getElementById('attachments-list-edit');
    list.innerHTML = '';
    
    if (files.length === 0) {
        list.innerHTML = '<p class="small" style="text-align:center;">لا توجد مرفقات حالياً.</p>';
        document.getElementById('btn-view-attachments').style.display = 'none';
        return;
    }
    
    document.getElementById('btn-view-attachments').style.display = 'block';

    files.forEach((file, index) => {
        const tag = document.createElement('div');
        tag.className = 'attachment-tag';
        tag.innerHTML = `
            <span>📎 ${file.name} (${(file.size / 1024).toFixed(2)} KB)</span>
            <button data-index="${index}" onclick="removeAttachment(${index})">✖</button>
        `;
        list.appendChild(tag);
    });
}

// فتح نافذة عرض المرفقات في المحرر
document.getElementById('btn-view-attachments').onclick = () => {
    viewAttachmentsModal.classList.add('show');
    // القائمة تُعرض تلقائياً عند فتح المحرر
};
document.getElementById('view-attachments-close').onclick = () => {
    viewAttachmentsModal.classList.remove('show');
};

// وظيفة إرفاق ملفات
document.getElementById('btn-attach-files').onclick = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        let filesSaved = 0;
        
        for (const file of files) {
            const fileId = `f${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            try {
                // حفظ الملف في IndexedDB
                await saveFile(fileId, file);
                
                // إضافة الملف إلى قائمة المرفقات الميتا (Meta)
                currentAttachments.push({
                    id: fileId,
                    name: file.name,
                    size: file.size,
                    type: file.type
                });
                filesSaved++;
            } catch (error) {
                console.error('Error saving file:', error);
                showMessage(`خطأ في حفظ الملف ${file.name}.`, 'error');
            }
        }
        
        // تحديث العنصر في قاعدة البيانات
        const item = getItemById(currentEditId);
        if (item) {
            item.files = currentAttachments;
            saveMeta();
        }

        renderAttachmentsEdit(currentAttachments); // تحديث العرض في نافذة التعديل
        showMessage(`تم إرفاق ${filesSaved} ملف بنجاح.`, 'success');
    };
    input.click();
};

// وظيفة إزالة مرفق من القائمة (لا تحذف الملف من IndexedDB حالياً)
function removeAttachment(index) {
    if (confirm('هل أنت متأكد من إزالة هذا المرفق من قائمة المادة؟')) {
        currentAttachments.splice(index, 1);
        
        // تحديث العنصر في قاعدة البيانات
        const item = getItemById(currentEditId);
        if (item) {
            item.files = currentAttachments;
            saveMeta();
        }
        renderAttachmentsEdit(currentAttachments);
        showMessage('تمت إزالة المرفق من القائمة.', 'neutral');
    }
}

// ----------------------------------------------------
// 10. وظائف لوحة الإدارة (Admin Panel)
// ----------------------------------------------------

// فتح مودال كلمة المرور
document.getElementById('btn-admin').onclick = () => {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true') {
        openAdminPanel();
        return;
    }
    
    // إخفاء/إظهار حقل الإدخال حسب ما إذا كانت كلمة المرور مُعينة أم لا
    const pwInfo = document.getElementById('password-info');
    const pwInput = document.getElementById('admin-password-input');
    
    if (meta.password) {
        pwInfo.innerText = 'أدخل كلمة المرور للدخول.';
        pwInput.placeholder = 'كلمة المرور';
    } else {
        pwInfo.innerText = 'الرجاء تعيين كلمة مرور لأول مرة (مطلوب).';
        pwInput.placeholder = 'كلمة المرور الجديدة';
    }

    passwordModal.classList.add('show');
    pwInput.focus();
};

// إغلاق مودال كلمة المرور
document.getElementById('close-password-modal').onclick = () => {
    passwordModal.classList.remove('show');
    document.getElementById('admin-password-input').value = '';
};

// إرسال كلمة المرور والتحقق
document.getElementById('submit-password').onclick = async () => {
    const password = document.getElementById('admin-password-input').value;
    if (!password) {
        return showMessage('الرجاء إدخال كلمة المرور.', 'error');
    }

    if (!meta.password) {
        // تعيين كلمة المرور لأول مرة
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        meta.password = { hash: hash, salt: buf2b64(salt) };
        saveMeta();
        showMessage('تم تعيين كلمة المرور بنجاح.', 'success');
        sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
        passwordModal.classList.remove('show');
        document.getElementById('admin-password-input').value = '';
        openAdminPanel();
    } else {
        // التحقق من كلمة المرور
        const verified = await verifyPassword(password);
        if (verified) {
            showMessage('تم التحقق بنجاح. أهلاً بك في لوحة الإدارة.', 'success');
            sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
            passwordModal.classList.remove('show');
            document.getElementById('admin-password-input').value = '';
            openAdminPanel();
        } else {
            showMessage('كلمة المرور غير صحيحة.', 'error');
        }
    }
};

// فتح لوحة الإدارة
function openAdminPanel() {
    renderAdminIndexList();
    adminModal.classList.add('show');
    // إخفاء لوحة تحرير الفهرس عند فتح اللوحة الرئيسية
    contentManagerArea.style.display = 'none';
    btnShowIndexManager.innerText = 'فتح لوحة تحرير الفهرس';
}
document.getElementById('admin-close').onclick = () => {
    adminModal.classList.remove('show');
};

// عرض قائمة إدارة التصنيفات (في لوحة الإدارة)
function renderAdminIndexList() {
    const list = document.getElementById('admin-index-list');
    list.innerHTML = '';

    meta.types.forEach(type => {
        const div = document.createElement('div');
        div.className = 'admin-index-item';
        div.innerHTML = `
            <span style="font-weight:bold;color:var(--accent)">${type.icon} ${type.name}</span>
            <div class="actions">
                <button class="btn neutral small" onclick="editType('${type.id}')">✏️ تعديل الاسم</button>
                <button class="btn neutral small" onclick="deleteType('${type.id}')">🗑️ حذف</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// وظائف إدارة التصنيفات
document.getElementById('btn-add-type').onclick = () => {
    const title = document.getElementById('new-type-title').value.trim();
    const icon = document.getElementById('new-type-icon').value.trim() || '❓';
    if (!title) return showMessage('الرجاء إدخال اسم التصنيف.', 'error');

    meta.types.push({
        id: `t${Date.now()}`,
        icon: icon,
        name: title,
        items: []
    });
    saveMeta();
    renderTopStrip();
    renderAdminIndexList();
    document.getElementById('new-type-title').value = '';
    document.getElementById('new-type-icon').value = '';
    showMessage(`تم إضافة التصنيف "${title}" بنجاح.`, 'success');
};

function editType(id) {
    const type = getItemById(id);
    if (!type) return;
    const newName = prompt('أدخل الاسم الجديد للتصنيف:', type.name);
    if (newName) {
        type.name = newName.trim();
        const newIcon = prompt('أدخل الأيقونة الجديدة للتصنيف:', type.icon);
        if (newIcon) type.icon = newIcon.trim();
        saveMeta();
        renderTopStrip();
        renderAdminIndexList();
        renderEditableIndex(); // تحديث قائمة التحرير
        showMessage('تم تحديث التصنيف بنجاح.', 'success');
    }
}

function deleteType(id) {
    if (confirm('تحذير: هل أنت متأكد من حذف هذا التصنيف وكل ما يحتويه؟ لا يمكن التراجع!')) {
        const index = meta.types.findIndex(t => t.id === id);
        if (index !== -1) {
            meta.types.splice(index, 1);
            saveMeta();
            renderTopStrip();
            renderAdminIndexList();
            renderEditableIndex(); // تحديث قائمة التحرير
            showMessage('تم حذف التصنيف بنجاح.', 'success');
        }
    }
}

// ----------------------------------------------------
// 11. وظائف النسخ الاحتياطي والاستعادة (Import/Export)
// ----------------------------------------------------

// تصدير الفهرس (Meta JSON)
document.getElementById('admin-export-meta').onclick = () => {
    const dataStr = JSON.stringify(meta, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maktabat_alaysaei_meta_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMessage('تم تصدير الفهرس (JSON) بنجاح.', 'success');
};

// استيراد الفهرس (Meta JSON)
document.getElementById('admin-import-meta').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedMeta = JSON.parse(e.target.result);
                if (importedMeta && importedMeta.types && Array.isArray(importedMeta.types)) {
                    meta = importedMeta;
                    saveMeta();
                    ensureDefaults(); // لتحديث القوائم إذا تغيرت
                    renderTopStrip();
                    renderAdminIndexList();
                    renderPublicIndex();
                    renderEditableIndex(); // تحديث قائمة التحرير
                    showMessage('تم استيراد الفهرس بنجاح. يرجى مراجعة المحتوى.', 'success');
                } else {
                    throw new Error('ملف JSON غير صالح أو لا يحتوي على هيكل "types".');
                }
            } catch (error) {
                showMessage(`خطأ في استيراد الملف: ${error.message}`, 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
};

// تصدير قاعدة البيانات الكاملة (IndexedDB + Meta)
document.getElementById('admin-export-files').onclick = async () => {
    showMessage('جاري تجهيز النسخ الاحتياطي... قد يستغرق وقتاً.', 'neutral');
    try {
        const allFiles = await new Promise((res, rej) => {
            const store = getObjectStore(FILE_STORE, 'readonly');
            const rq = store.getAll();
            rq.onsuccess = (e) => res(e.target.result);
            rq.onerror = (e) => rej(e.target.error);
        });
        const allUploads = await getAllUploads();

        const backupData = {
            meta: meta,
            files: allFiles,
            uploads: allUploads,
            timestamp: Date.now()
        };

        const dataStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `maktabat_alaysaei_backup_full_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage('تم تصدير قاعدة البيانات الكاملة بنجاح.', 'success');
    } catch (error) {
        console.error('Full backup error:', error);
        showMessage('فشل في تصدير قاعدة البيانات الكاملة. تحقق من Console.', 'error');
    }
};

// ----------------------------------------------------
// 12. وظائف إدارة كلمة المرور والحماية
// ----------------------------------------------------

// تعيين/تغيير كلمة المرور
document.getElementById('btn-set-password').onclick = async () => {
    const newPassword = prompt('أدخل كلمة المرور الجديدة:');
    if (newPassword) {
        if (newPassword.length < 6) return showMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل.', 'error');
        const salt = generateSalt();
        const hash = await hashPassword(newPassword, salt);
        meta.password = { hash: hash, salt: buf2b64(salt) };
        saveMeta();
        showMessage('تم تعيين/تغيير كلمة المرور بنجاح.', 'success');
    }
};

// إعادة ضبط كلمة المرور (حذف الهاش)
document.getElementById('btn-reset-password').onclick = () => {
    if (confirm('تحذير: هل أنت متأكد من إعادة ضبط كلمة المرور؟ سيتم حذفها وستحتاج إلى تعيينها مجدداً عند الدخول للوحة الإدارة.')) {
        meta.password = null;
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        saveMeta();
        showMessage('تم إعادة ضبط كلمة المرور بنجاح. يرجى تعيينها مجدداً عند الدخول.', 'success');
    }
};


// ----------------------------------------------------
// 13. وظائف نموذج المراسلة (Contact Form)
// ----------------------------------------------------

document.getElementById('submit-upload').onclick = async () => {
    const name = document.getElementById('visitor-name').value.trim();
    const message = document.getElementById('visitor-message').value.trim();
    const filesInput = document.getElementById('visitor-files');
    const files = Array.from(filesInput.files);

    if (!message && files.length === 0) {
        return showMessage('الرجاء إدخال رسالة أو إرفاق ملفات.', 'error');
    }

    let fileDetails = [];
    let filesSavedCount = 0;

    showMessage('جاري حفظ الرسالة والمرفقات محلياً...', 'neutral');
    
    // حفظ الملفات المرفقة أولاً
    for (const file of files) {
        const fileId = `u${Date.now()}-${filesSavedCount}-${Math.floor(Math.random() * 1000)}`;
        try {
            await saveFile(fileId, file);
            fileDetails.push({
                id: fileId,
                name: file.name,
                size: file.size,
                type: file.type
            });
            filesSavedCount++;
        } catch (error) {
            console.error('Error saving uploaded file:', error);
            showMessage(`خطأ في حفظ الملف ${file.name}.`, 'error');
        }
    }

    // حفظ بيانات الإرسالية في متجر uploads
    const uploadData = {
        name: name || 'زائر غير مسجل',
        message: message,
        files: fileDetails,
        date: new Date().toISOString()
    };
    
    try {
        await saveUpload(uploadData);
        showMessage('تم حفظ رسالتك محلياً بنجاح!', 'success');
        // تفريغ النموذج
        document.getElementById('visitor-name').value = '';
        document.getElementById('visitor-message').value = '';
        filesInput.value = '';
    } catch (error) {
        console.error('Error saving upload meta:', error);
        showMessage('خطأ في حفظ بيانات الرسالة. راجع Console.', 'error');
    }
};

// عرض المرسلات
document.getElementById('admin-view-uploads').onclick = async () => {
    const list = document.getElementById('uploads-list');
    list.innerHTML = 'جاري التحميل...';
    uploadsModal.classList.add('show');
    
    try {
        const uploads = await getAllUploads();
        list.innerHTML = '';
        
        if (uploads.length === 0) {
            list.innerHTML = '<p class="small" style="text-align:center;padding:15px">لا توجد رسائل واردة حالياً.</p>';
            return;
        }
        
        uploads.sort((a, b) => new Date(b.date) - new Date(a.date)); // الأحدث أولاً

        uploads.forEach(upload => {
            const uploadEl = document.createElement('div');
            uploadEl.className = 'card'
            uploadEl.style.marginBottom = '10px';
            uploadEl.style.backgroundColor = '#1f1a14';
            uploadEl.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding-bottom:5px;margin-bottom:8px">
                    <span style="font-weight:bold;color:var(--accent)">${upload.name}</span>
                    <span class="small">${new Date(upload.date).toLocaleString()}</span>
                </div>
                <p>${upload.message || '... لا توجد رسالة نصية ...'}</p>
                <div style="margin-top:8px">
                    ${upload.files.map(file => `
                        <a href="#" class="attachment-tag" style="display:inline-flex" 
                           onclick="handleUploadFileDownload(event, '${file.id}', '${file.name}')">
                           ⬇️ ${file.name} (${(file.size / 1024).toFixed(2)} KB)
                        </a>
                    `).join('')}
                </div>
            `;
            list.appendChild(uploadEl);
        });
        
    } catch (error) {
        console.error('Error viewing uploads:', error);
        list.innerHTML = '<p class="small" style="color:var(--error);padding:15px">خطأ في تحميل المرسلات.</p>';
    }
};

// وظيفة تنزيل ملف مرفق في المرسلات
async function handleUploadFileDownload(e, fileId, fileName) {
    e.preventDefault();
    showMessage(`جاري تحميل المرفق: ${fileName}`, 'neutral');
    const blob = await getFile(fileId);
    if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage(`تم تنزيل المرفق: ${fileName}`, 'success');
    } else {
        showMessage(`خطأ في تحميل المرفق: ${fileName}`, 'error');
    }
}

document.getElementById('uploads-close').onclick = () => {
    uploadsModal.classList.remove('show');
};

// حذف كل المرسلات
document.getElementById('admin-clear-uploads').onclick = async () => {
    if (confirm('تحذير: هل أنت متأكد من حذف جميع المرسلات وقاعدة بياناتها؟ لا يمكن التراجع!')) {
        try {
            await clearUploads();
            showMessage('تم حذف جميع المرسلات بنجاح.', 'success');
            document.getElementById('uploads-list').innerHTML = '<p class="small" style="text-align:center;padding:15px">لا توجد رسائل واردة حالياً.</p>';
        } catch (error) {
            console.error('Error clearing uploads:', error);
            showMessage('فشل في حذف المرسلات.', 'error');
        }
    }
};


// ----------------------------------------------------
// 14. وظائف عامة (Copy/Print/Share)
// ----------------------------------------------------

document.getElementById('btn-copy-selected').addEventListener('click', () => {
    const text = viewerContent.innerText;
    if (!text) return showMessage('لا يوجد محتوى للنسخ.', 'error');
    
    // إضافة ترويسة بسيطة
    const title = itemTitle.innerText;
    const subtitle = itemSubtitle.innerText;
    const textToCopy = `*** ${title} - ${subtitle || ''} ***\n\n${text}`;

    navigator.clipboard.writeText(textToCopy)
        .then(() => showMessage('تم نسخ المحتوى بنجاح إلى الحافظة.', 'success'))
        .catch(err => {
            console.error('Copy failed: ', err);
            showMessage('فشل في النسخ. يرجى محاولة النسخ يدوياً.', 'error');
        });
});

document.getElementById('btn-print-selected').addEventListener('click', ()=>{
    const content = viewerContent.innerHTML;
    if (!content) return showMessage('لا يوجد محتوى للطباعة.', 'error');
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>${itemTitle.innerText}</title>
                <style>
                    /* استيراد تنسيقات الطباعة القانونية */
                    body { font-family: Tahoma, Arial, sans-serif; direction: rtl; padding: 20px; color: #000; }
                    .viewer p { counter-reset: p-counter; padding-right: 30px; position: relative; line-height: 1.8; margin-bottom: 15px; }
                    .viewer p:before { counter-increment: p-counter; content: "المادة (" counter(p-counter) ") "; font-weight: bold; color: #444; position: absolute; right: 0; top: 0; }
                    .viewer h1, .viewer h2, .viewer h3 { color: #333; margin-top: 20px; margin-bottom: 10px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
                    .viewer p.no-number:before { content: ""; counter-increment: none; padding-right: 0; }
                    .viewer p.no-number { padding-right: 0; }
                </style>
            </head>
            <body>
                <h1 style="text-align:center">${itemTitle.innerText}</h1>
                <h3 style="text-align:center;color:#666">${itemSubtitle.innerText}</h3>
                <div class="viewer">${content}</div>
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
});

document.getElementById('btn-share-selected').addEventListener('click', async ()=>{
    if(navigator.share){
        await navigator.share({
            title: itemTitle.innerText,
            text: viewerContent.innerText
        }).catch(err => {
            if (err.name !== 'AbortError') { // تجاهل الأخطاء الناتجة عن إلغاء المستخدم
                showMessage('فشل في المشاركة.', 'error');
            }
        });
    } else {
        showMessage('المشاركة غير مدعومة في هذا الجهاز.', 'error');
    }
});


// ----------------------------------------------------
// 15. التهيئة (Initialization)
// ----------------------------------------------------

// مستمع حدث فتح لوحة تحرير الفهرس
btnShowIndexManager.onclick = () => {
    const isHidden = contentManagerArea.style.display === 'none';
    contentManagerArea.style.display = isHidden ? 'block' : 'none';
    btnShowIndexManager.innerText = isHidden ? 'إخفاء لوحة تحرير الفهرس' : 'فتح لوحة تحرير الفهرس';
    
    if (isHidden) {
        renderEditableIndex();
    }
};

window.addEventListener('load', async () => {
    // 1. تهيئة قاعدة البيانات
    try {
        await openDB();
        console.log('IndexedDB initialized.');
    } catch (error) {
        console.error('Error initializing IndexedDB:', error);
        showMessage('خطأ في تهيئة قاعدة البيانات المحلية.', 'error');
    }
    
    // 2. تحميل البيانات الأساسية
    ensureDefaults();
    
    // 3. عرض الواجهة
    renderTopStrip();
    renderPublicIndex();
    
    // 4. عرض زر التثبيت (PWA Install Prompt)
    let deferredPrompt;
    const installBtn = document.getElementById('btn-install');
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'inline-block';
    });
    
    installBtn.addEventListener('click', (e) => {
        installBtn.style.display = 'none';
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showMessage('تم تثبيت التطبيق بنجاح!', 'success');
            } else {
                showMessage('تم إلغاء التثبيت.', 'neutral');
            }
            deferredPrompt = null;
        });
    });

    // 5. تم حذف مستمعي الأحداث لزر القائمة (dots)

    // 6. اختيار أول تصنيف وعرضه مبدئياً
    if (meta.types.length > 0) {
        openType(meta.types[0].id);
    }
    
    // 7. تم حذف مستمع إغلاق قائمة السياق عند النقر خارجها
});
