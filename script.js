// ------------------ FIREBASE INIT ------------------

const firebaseConfig = {
    apiKey: "AIzaSyAEw8RECWhK4HHkpgUF9_A423aRtWWoihk",
    authDomain: "cyclic-behavior-type-data.firebaseapp.com",
    projectId: "cyclic-behavior-type-data",
    storageBucket: "cyclic-behavior-type-data.firebasestorage.app",
    messagingSenderId: "266042564140",
    appId: "1:266042564140:web:c2db487fd1e60094f0fb89",
    measurementId: "G-L458F78KEN"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();


// ------------------ GLOBAL ------------------
let currentUser = null;
let cachedQuestions = [];
let responses = {};
const IMAGE_BASE = "https://Figures.s3.us-west-004.backblazeb2.com";
let preloadExcelMap = {};
let preloadSigmaMap = {};
const STD_RATIO_BY_RESEARCHER = {
    AJ:  [0.386128, 0.232307, 0.286643, 0.413166],
    AS:  [0.366791, 0.250667, 0.218948, 0.397956],
    AWS: [0.498178, 0.533583, 0.476322, 0.582728],
    JPS: [0.550177, 0.462844, 0.430713, 0.476860],
    KJU: [0.592111, 0.428295, 0.459287, 0.616389],
    SJB: [0.513639, 0.505644, 0.496326, 0.513240],
    SLK: [0.466566, 0.463459, 0.360218, 0.425924],
    VR:  [0.468630, 0.342139, 0.240086, 0.417804],
    KOC: [0.412762, 0.396967, 0.350511, 0.504387]
};

function getStdRatio(researcher, mu) {
    const ratios = STD_RATIO_BY_RESEARCHER[researcher];

    if (!ratios || isNaN(mu)) return 1;

    if (mu <= 0.25) return ratios[0];
    if (mu <= 0.50) return ratios[1];
    if (mu <= 0.75) return ratios[2];
    return ratios[3];
}


async function loadPreloadExcel() {
    const selectedStrain = document.getElementById("strain_type")?.value;
    const researcher = document.getElementById("researcher-name")?.value;

    if (!selectedStrain || !researcher) {
        preloadExcelMap = {};
        preloadSigmaMap = {};
        return;
    }

    const filePath = `Excel_Files_DA_9_Model/CDSS_New_Eliminated_with_mu_sigma_bands_${selectedStrain}_Model_DA_9.csv`;

    try {
        const response = await fetch(filePath);
        const arrayBuffer = await response.arrayBuffer();

        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const muColumn = `mu_hat_${researcher}_LC`;
        const sigmaColumn = `sigma_hat_${researcher}_LC`;

        preloadExcelMap = {};
        preloadSigmaMap = {};

        data.forEach(row => {
            const testNum = Number(row["Test_Number"]);
            const muValue = row[muColumn];
            const sigmaValue = row[sigmaColumn];

            if (!isNaN(testNum) && muValue !== undefined && muValue !== null && muValue !== "") {
                preloadExcelMap[testNum] = Number(muValue);
            }

            if (!isNaN(testNum) && sigmaValue !== undefined && sigmaValue !== null && sigmaValue !== "") {
                preloadSigmaMap[testNum] = Number(sigmaValue);
            }
        });

        console.log("Preload Excel loaded:", filePath);
    } catch (error) {
        console.error("Failed to load preload Excel:", error);
        preloadExcelMap = {};

        preloadSigmaMap = {};
    }
    console.log("selectedStrain:", selectedStrain);
    console.log("researcher:", researcher);
    console.log("filePath:", filePath);
}

function normalizeEmail(email) {
    return (email || "").toLowerCase().trim();
}

// ------------------ AUTH STATE LISTENER ------------------

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        console.log("Not logged in");

        document.getElementById("login-page").style.display = "block";
        document.getElementById("quiz-container").style.display = "none";
        return;
    }

    // User is logged in
    currentUser = {
    ...user,
    email: normalizeEmail(user.email),
    uid: normalizeEmail(user.email)   // <-- KEY CHANGE: docId becomes email
    };
    console.log("Logged in:", currentUser.email, "DOC ID:", currentUser.uid);

    // Show quiz
    document.getElementById("login-page").style.display = "none";
    document.getElementById("quiz-container").style.display = "block";

    // 1) Seed from preload (only if user's doc doesn't exist)
    await seedFromPreloadIfNeeded();
    await loadExistingResponses();
    

    // Only load questions once
    if (cachedQuestions.length === 0) {
        await loadQuestions();
    }
});

// async function findUidByEmail(email) {
//     const snap = await db
//         .collection("responses_all_tests")
//         .where("email", "==", normalizeEmail(email))
//         .limit(1)
//         .get();

//     if (!snap.empty) return snap.docs[0].id;
//     return null;
// }

// ------------------ GOOGLE LOGIN ------------------

async function googleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);
        console.log("Login successful:", result.user.email);

    } catch (error) {
        console.error("Login error:", error);
        alert("Google login failed: " + error.message);
    }
}

// ------------------ EMAIL-ONLY LOGIN (NO AUTH) ------------------

function generateFakeUID() {
    return "local_" + Math.random().toString(36).substr(2, 9) + Date.now();
}

async function emailOnlyLogin() {
    const email = document.getElementById("email-login").value.trim();
    const errorDiv = document.getElementById("email-error");

    // Basic email validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
        errorDiv.textContent = "Please enter a valid email address.";
        errorDiv.style.visibility = "visible";
        return;
    } else {
        errorDiv.style.visibility = "hidden";
    }

    const emailKey = normalizeEmail(email);

    currentUser = {
    email: emailKey,
    uid: emailKey,          // <-- same docId rule
    isLocalUser: true
    };

    console.log("Email-only login:", currentUser);

    // Load previous responses
    responses = {};
    console.log("Email-only mode: Firestore disabled (no auth).");  

    // SHOW QUIZ
    document.getElementById("login-page").style.display = "none";
    document.getElementById("quiz-container").style.display = "block";

    // Load questions if not loaded yet
    if (cachedQuestions.length === 0) {
        await loadQuestions();
    }
}

async function loadExistingResponsesByEmail(email) {
  const emailKey = normalizeEmail(email);
  const snap = await db.collection("responses_all_tests").doc(emailKey).get();

  if (snap.exists) {
    const data = snap.data();
    responses = data.responses || {};
    document.getElementById("researcher-name").value = data.name || "";
    console.log("Loaded saved email-only responses.");
  } else {
    responses = {};
    console.log("No existing email-only responses found.");
  }
}

// ------------------ PRELOAD RESPONSES BY EMAIL ------------------
async function seedFromPreloadIfNeeded() {
    if (!currentUser?.uid || !currentUser?.email) return;

    const userRef = db.collection("responses_all_tests").doc(currentUser.uid);
    const userSnap = await userRef.get();

    // Do NOT overwrite existing real responses
    if (userSnap.exists) return;

    const emailKey = normalizeEmail(currentUser.email);
    const preloadRef = db.collection("preloads_internal").doc(emailKey);
    const preloadSnap = await preloadRef.get();

    if (!preloadSnap.exists) return;

    const preload = preloadSnap.data();

    await userRef.set({
        uid: currentUser.uid,
        email: emailKey,
        name: preload.name || "",
        responses: preload.responses || {},
        seededFromPreload: true,
        savedAt: new Date().toISOString()
    }, { merge: true });

    console.log("Preloaded responses seeded for", emailKey);
}

// ------------------ LOAD PREVIOUS RESPONSES ------------------

async function loadExistingResponses() {
  if (!currentUser) return;

  const emailKey = normalizeEmail(currentUser.email);

  try {
    const emailDocRef = db.collection("responses_all_tests").doc(emailKey);
    const emailSnap = await emailDocRef.get();

    if (emailSnap.exists) {
      const data = emailSnap.data();
      responses = data.responses || {};
      document.getElementById("researcher-name").value = data.name || "";
      console.log("Loaded responses from EMAIL doc:", emailKey);
    } else {
      responses = {};
      console.log("No existing responses found for:", emailKey);
    }
  } catch (err) {
    console.error("Failed to load responses:", err);
    responses = {};
  }
}


// ------------------ LOAD QUESTIONS ------------------

async function loadQuestions() {
    const response = await fetch("questions.json");
    cachedQuestions = await response.json();
    renderPage(-1);
}


// ------------------ PAGE NAVIGATION (UNCHANGED) ------------------

async function navigatePage(index) {
    console.log(`Navigating to index: ${index}`);

    if (index === 0) {
        const researcher = document.getElementById("researcher-name")?.value;

        if (!researcher) {
            alert("Please select a researcher before continuing.");
            return;
        }

        await loadPreloadExcel();
    }

    if (index >= 0 && index < cachedQuestions.length) {
        renderPage(index);
    } else if (index === -1) {
        renderPage(-1);
    } else if (index === -2) {
        renderPage(-2);
    } else {
        console.error(`Invalid navigation request. Index: ${index}`);
    }
}

// ------------------ PAGE RENDERING (UNCHANGED EXCEPT LOADING) ------------------

function renderPage(index) {
    if (index === -1) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('page-1').classList.add('active');
    } else if (index === -2) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('last_page').classList.add('active');
    } else if (index >= 0 && index < cachedQuestions.length) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        const container = document.getElementById('quiz-container');
        const question = cachedQuestions[index];
        container.querySelector('.dynamic-question')?.remove();

        const savedBehavior = responses[question.questionNumber]?.behavior || "";
        const savedComments = responses[question.questionNumber]?.comments || "";
        const preloadMu = preloadExcelMap[question.testNumber];
        const preloadSigma = preloadSigmaMap[question.testNumber];
        const existingResponse = responses[question.questionNumber];

        const hasFirestoreResponse =
            existingResponse &&
            (
                existingResponse.slider !== undefined ||
                existingResponse.stddev !== undefined ||
                existingResponse.top_behavior !== undefined ||
                existingResponse.behavior !== undefined ||
                existingResponse.comments !== undefined
            );

        const preloadSliderValue =
            preloadMu !== undefined && !isNaN(preloadMu)
                ? Number(preloadMu.toFixed(2))
                : 0.5;

        const savedSliderValue = hasFirestoreResponse
            ? parseFloat(existingResponse.slider)
            : preloadSliderValue;

        const researcher = document.getElementById("researcher-name")?.value;

        const preloadStdDev =
            preloadSigma !== undefined && !isNaN(preloadSigma)
                ? Number((preloadSigma * getStdRatio(researcher, preloadSliderValue)).toFixed(2))
                : 0.1;

        const savedStdDev = hasFirestoreResponse
            ? parseFloat(existingResponse.stddev)
            : preloadStdDev;
        const preloadTopBehavior =
            preloadSliderValue > 0.5 ? "Sand-like" :
            preloadSliderValue < 0.5 ? "Clay-like" :
            "";

        const savedTopBehavior =
            responses[question.questionNumber]?.top_behavior || preloadTopBehavior;

        const questionDiv = document.createElement('div');
        questionDiv.className = 'page active dynamic-question';

        questionDiv.innerHTML = `
            <div class="question-wrapper">

                <div class="question-header">
                    <h2>Question ${question.questionNumber}/${cachedQuestions.length}</h2>
                </div>

                <div class="navigation-buttons">
                    <button onclick="goToPage(${question.questionNumber}, 0)"
                            style="margin-left: 20px; background:#4CAF50; color:white;">
                        Go to First Question
                    </button>

                    <button onclick="goToPage(${question.questionNumber}, ${index - 1})"
                            ${index === 0 ? "disabled" : ""}>Back</button>

                    <button onclick="goToPage(${question.questionNumber},
                            ${index === cachedQuestions.length - 1 ? -2 : index + 1})">
                        ${index === cachedQuestions.length - 1 ? "Submit Page" : "Next"}
                    </button>

                    <button onclick="goToPage(${question.questionNumber}, ${cachedQuestions.length - 1})"
                            style="margin-left: 20px; background:#4CAF50; color:white;">
                        Go to Last Question
                    </button>
                </div>

                <!-- IMAGE AREA -->
                <div class="image-area">
                    <div style="margin-bottom:10px;">
                        <select id="strain_select_${question.questionNumber}" class="strain-selector">
                            <option value="3_SA">3% SA Strain</option>
                            <option value="4_SA">4% SA Strain</option>
                            <option value="5_SA">5% SA Strain</option>
                            <option value="6_SA">6% SA Strain</option>
                            <option value="6_DA">6% DA Strain</option>
                            <option value="8_DA">8% DA Strain</option>
                            <option value="9_DA">9% DA Strain</option>
                            <option value="10_DA">10% DA Strain</option>
                            <option value="12_DA">12% DA Strain</option>
                            <option value="Last_Cycle">Last Cycle</option>
                        </select>
                    </div>

                    <div id="img_wrapper_${question.questionNumber}" class="image-wrapper">
                        <img id="strain_image_${question.questionNumber}"
                            src=""
                            alt="Strain Cycle Image"
                            style="display:none;">
                    </div>

                    <div id="missing_image_${question.questionNumber}"
                        style="display:none; color:#a00; font-size:18px; font-weight:bold; margin-top:10px;">
                    </div>
                </div>

                <!-- BOTTOM ROW -->
                <div class="bottom-row">

                    <!-- Behavior column -->
                    <div class="behavior-box">
                    <div style="margin-bottom:15px;">
                            <p><b>Please select the det. behavior:</b></p>

                            <label style="margin-right:15px;">
                                <input type="radio"
                                    name="top_behavior_${question.questionNumber}"
                                    value="Clay-like"
                                    ${savedTopBehavior === "Clay-like" ? "checked" : ""}>
                                Clay-like
                            </label>

                            <label>
                                <input type="radio"
                                    name="top_behavior_${question.questionNumber}"
                                    value="Sand-like"
                                    ${savedTopBehavior === "Sand-like" ? "checked" : ""}>
                                Sand-like
                            </label>
                        </div>
                        <p>Please select the behavior type:</p>

                        <div style="display:flex; gap:10px; align-items:center;">
                            <label>Clay-like (0.01)</label>
                            <input type="range" id="slider_${question.questionNumber}"
                                min="0.01" max="0.99" step="0.01"
                                value="${savedSliderValue}"
                                ${savedBehavior === "data not usable" ? "disabled" : ""}>
                            <label>Sand-like (0.99)</label>
                        </div>

                        <p>Current Value:
                            <input type="number"
                                id="slider_input_${question.questionNumber}"
                                value="${savedSliderValue}"
                                min="0.01" max="0.99" step="0.01"
                                style="width:60px;"
                                ${savedBehavior === "data not usable" ? "disabled" : ""}>
                            <span id="mean_range_${question.questionNumber}"
                                style="margin-left:10px; font-size:14px; color:#888;">
                            </span>
                        </p>

                        <label>
                            <input type="checkbox" name="behavior_${question.questionNumber}" 
                                value="data not usable"
                                ${savedBehavior === "data not usable" ? "checked" : ""}>
                            Data is not usable
                        </label>

                        <div style="margin-top:10px; display:flex; flex-direction:column;">

                            <div style="display:flex; align-items:center; gap:10px;">
                                <label><b>Standard Deviation:</b></label>

                                    <input  
                                        type="number" 
                                        id="stddev_${question.questionNumber}"
                                        value="${savedStdDev}" 
                                        min="0.01" 
                                        step="0.01"
                                        style="width:100px;"
                                        ${savedBehavior === "data not usable" ? "disabled" : ""}
                                    />
                            </div>

                        </div>
                    </div>

                    <!-- Plot column -->
                    <div id="plot_${question.questionNumber}" class="plot-box"></div>

                    <!-- Comments column -->
                    <div class="comments-box">
                        <h3>Comments</h3>
                        <textarea id="comments_${question.questionNumber}" 
                                placeholder="Enter your comments here...">${savedComments}</textarea>
                    </div>

                </div>

                <!-- Bottom navigation -->
                <div class="navigation-buttons" style="margin-top:10px;">
                    <button onclick="goToPage(${question.questionNumber}); navigatePage(${index - 1})"
                            ${index === 0 ? "disabled" : ""}>Back</button>

                    <button onclick="goToPage(${question.questionNumber}, 
                            ${index === cachedQuestions.length - 1 ? -2 : index + 1})">
                        ${index === cachedQuestions.length - 1 ? "Submit Page" : "Next"}
                    </button>
                </div>

            </div>
        `;
        container.appendChild(questionDiv);

        const slider = document.getElementById(`slider_${question.questionNumber}`);
        const sliderInput = document.getElementById(`slider_input_${question.questionNumber}`);
        const stddevInput = document.getElementById(`stddev_${question.questionNumber}`);
        const topBehaviorRadios = document.querySelectorAll(`input[name="top_behavior_${question.questionNumber}"]`);
        const radioButton = document.querySelector(`input[name="behavior_${question.questionNumber}"][value="data not usable"]`);


        const strainSelect = document.getElementById(`strain_select_${question.questionNumber}`);
        const piSelect = document.getElementById("pi_selection");

        // Default selection = 9% DA strain
        strainSelect.value = "9_DA";

        updateStrainImage(question.questionNumber, question.testNumber);

        // Change image automatically when the user selects a different strain
        strainSelect.addEventListener("change", () => {
            updateStrainImage(question.questionNumber, question.testNumber);
        });
        piSelect.addEventListener("change", () => {
            updateStrainImage(question.questionNumber, question.testNumber);
        });
        function syncTopBehaviorFromMean() {
            const mean = parseFloat(slider.value);

            topBehaviorRadios.forEach(r => r.checked = false);

            if (mean > 0.5) {
                const sandRadio = document.querySelector(`input[name="top_behavior_${question.questionNumber}"][value="Sand-like"]`);
                if (sandRadio) sandRadio.checked = true;
            } else if (mean < 0.5) {
                const clayRadio = document.querySelector(`input[name="top_behavior_${question.questionNumber}"][value="Clay-like"]`);
                if (clayRadio) clayRadio.checked = true;
            }
        }
        // ----- IMAGE UPDATE FUNCTION -----
        function updateStrainImage(qNum, testNum) {
            const strainFolder = document.getElementById(`strain_select_${qNum}`).value;
            const researcher = document.getElementById("researcher-name").value;

            const piSelection = document.getElementById("pi_selection").value;
            const baseFolder = piSelection === "Yes" ? "Figures_PI" : "Figures_No_PI";

            const imgPath = `${IMAGE_BASE}/${baseFolder}/${researcher}/${strainFolder}/Test_Number_${testNum}.png`;

            const imgEl = document.getElementById(`strain_image_${qNum}`);
            const msgEl = document.getElementById(`missing_image_${qNum}`);

            imgEl.onload = function () {
                imgEl.style.display = "block";
                msgEl.style.display = "none";
            };

            imgEl.onerror = function () {
                imgEl.style.display = "none";
                msgEl.style.display = "block";
                msgEl.textContent = `${strainFolder.replace("_", " ").replace("_", " ")} is not available for this test`;
            };

            imgEl.src = imgPath;
        }
 

        slider.addEventListener('input', () => {
            sliderInput.value = slider.value;
            syncTopBehaviorFromMean();
        });

        sliderInput.addEventListener('input', () => {
            slider.value = sliderInput.value;
            syncTopBehaviorFromMean();
        });

        
        radioButton.addEventListener('change', (event) => {
            const isDisabled = event.target.checked;
            slider.disabled = isDisabled;
            sliderInput.disabled = isDisabled;
            stddevInput.disabled = isDisabled;
        });

    slider.addEventListener('input', () => {
        sliderInput.value = slider.value;
        plotBeta(question.questionNumber);
    });

    sliderInput.addEventListener('input', () => {
        slider.value = sliderInput.value;
        plotBeta(question.questionNumber);
    });

    stddevInput.addEventListener('input', () => {
        plotBeta(question.questionNumber);
    });

    plotBeta(question.questionNumber);
    } else {
        console.error(`Invalid page index: ${index}`);
    }

}


// const imgEl = document.getElementById(`strain_image_${question.questionNumber}`);
// const wrapper = document.getElementById(`img_wrapper_${question.questionNumber}`);


document.addEventListener("mousedown", function (e) {
    const wrapper = e.target.closest(".image-wrapper");
    if (!wrapper) return;

    const img = wrapper.querySelector("img");
    if (!img) return;

    const aspect = img.naturalWidth / img.naturalHeight;

    function onMove() {
        const w = wrapper.offsetWidth;
        wrapper.style.height = (w / aspect) + "px";
    }

    function stop() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", stop);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
});


async function saveProgressToFirestore() {
    if (!currentUser) return;

    // ✅ Step 2B: do NOT write to Firestore in email-only mode
    if (currentUser?.isLocalUser) {
        console.log("Email-only mode: skipping Firestore auto-save.");
        return;
    }

    const name = document.getElementById("researcher-name")?.value || "";

    const payload = {
        uid: currentUser.uid,
        email: currentUser.email,
        name: name,
        responses: responses,
        savedAt: new Date().toISOString()
    };

    try {
        await db.collection("responses_all_tests").doc(currentUser.uid).set(payload, { merge: true });
        console.log("Auto-saved progress");
    } catch (err) {
        console.error("Auto-save failed:", err);
    }
}

function logit(p) {
    const clipped = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    return Math.log(clipped / (1 - clipped));
}

function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

function plotBeta(questionNumber) {
    const meanInput = document.getElementById(`slider_${questionNumber}`);
    const stddevInput = document.getElementById(`stddev_${questionNumber}`);
    const plotDiv = document.getElementById(`plot_${questionNumber}`);

    if (!meanInput || !stddevInput || !plotDiv) return;

    const meanOriginal = parseFloat(meanInput.value);
    const sigmaZ = parseFloat(stddevInput.value);

    if (
        isNaN(meanOriginal) ||
        isNaN(sigmaZ) ||
        meanOriginal <= 0 ||
        meanOriginal >= 1 ||
        sigmaZ <= 0
    ) {
        return;
    }

    const muZ = logit(meanOriginal);

    const sigmaOriginal =
        (sigmoid(muZ + sigmaZ) - sigmoid(muZ - sigmaZ)) / 2;

    const z = [];
    const normalPDF = [];
    const muOriginalX = [];
    const originalPDF = [];

    const zMin = muZ - 4 * sigmaZ;
    const zMax = muZ + 4 * sigmaZ;

    for (let i = 0; i <= 1000; i++) {
        const pi = 0.001 + (0.998 * i / 1000);
        const zi = logit(pi);

        const normalDensity =
            (1 / (sigmaZ * Math.sqrt(2 * Math.PI))) *
            Math.exp(-0.5 * ((zi - muZ) / sigmaZ) ** 2);

        const originalDensity = normalDensity / (pi * (1 - pi));

        muOriginalX.push(pi);
        originalPDF.push(originalDensity);
    }

    for (let i = 0; i <= 1000; i++) {
        const zi = zMin + (zMax - zMin) * i / 1000;

        const normalDensity =
            (1 / (sigmaZ * Math.sqrt(2 * Math.PI))) *
            Math.exp(-0.5 * ((zi - muZ) / sigmaZ) ** 2);

        z.push(zi);
        normalPDF.push(normalDensity);
    }

    const tickVals = [];
    const tickText = [];

    for (let k = -2; k <= 2; k++) {
        const zTick = muZ + k * sigmaZ;
        const originalTick = sigmoid(zTick);

        tickVals.push(zTick);
        tickText.push(`${zTick.toFixed(2)}<br>(${originalTick.toFixed(2)})`);
    }

    Plotly.newPlot(plotDiv, [
        {
            x: muOriginalX,
            y: originalPDF,
            mode: "lines",
            line: { color: "black", width: 3 },
            name: "Original Space PDF",
            xaxis: "x",
            yaxis: "y"
        },
        {
            x: z,
            y: normalPDF,
            mode: "lines",
            line: { color: "black", width: 3 },
            name: "Transformed Normal PDF",
            xaxis: "x2",
            yaxis: "y2"
        }
    ], {
        margin: { t: 35, r: 15, b: 60, l: 55 },

        xaxis: {
            domain: [0, 1],
            anchor: "y",
            title: "CBT",
            range: [0, 1]
        },
        yaxis: {
            domain: [0.57, 1],
            title: "Density"
        },

        xaxis2: {
            domain: [0, 1],
            anchor: "y2",
            title: "Transformed CBT, logit(CBT)<br>(CBT)",
            tickvals: tickVals,
            ticktext: tickText
        },
        yaxis2: {
            domain: [0, 0.43],
            title: "Density"
        },

        
        legend: {
            title: {
                text:
                    `Mean: ${muZ.toFixed(2)} (${meanOriginal.toFixed(2)})<br>` +
                    `Sigma: ${sigmaZ.toFixed(2)} (${sigmaOriginal.toFixed(2)})`
            },
            x: 0,
            y: -0.25,
            orientation: "h"
        },

        showlegend: true
    }, {
        responsive: true
    });
}
// ------------------ SAVE & RESTORE ANSWERS ------------------

function updateSliderVisibility(q) {
    const selected = document.querySelector(`input[name="behavior_${q}"]:checked`);
    const div = document.getElementById(`slider_container_${q}`);
    div.style.display = (selected && selected.value === "slider") ? "block" : "none";
}

function saveAndNext(q) {
    saveAnswer(q);
    navigatePage(q + 1);
}

function saveAnswer(q) {
    if (!responses[q]) responses[q] = {};

    // single checkbox for "data not usable"
    const unusableCheckbox = document.querySelector(`input[name="behavior_${q}"]`);
    const slider = document.getElementById(`slider_${q}`);
    const std = document.getElementById(`stddev_${q}`);
    const com = document.getElementById(`comments_${q}`);
    const topBehavior = document.querySelector(`input[name="top_behavior_${q}"]:checked`);

    const isUnusable = unusableCheckbox && unusableCheckbox.checked;

    if (isUnusable) {
        
        responses[q].behavior = "data not usable";
        responses[q].slider = "";
        responses[q].stddev = "";
        
    } else {
        responses[q].behavior = slider ? slider.value : "";
        responses[q].slider = slider ? slider.value : "";
        responses[q].stddev = std ? std.value : "";
    }
    responses[q].comments = com ? com.value : "";
    responses[q].top_behavior = topBehavior ? topBehavior.value : "";
}
function validateQuestion(q) {
    const slider = document.getElementById(`slider_${q}`);
    const unusableCheckbox = document.querySelector(`input[name="behavior_${q}"]`);
    const topBehavior = document.querySelector(`input[name="top_behavior_${q}"]:checked`);

    const isUnusable = unusableCheckbox && unusableCheckbox.checked;
    const mean = slider ? parseFloat(slider.value) : NaN;

    if (!isUnusable && mean === 0.5 && !topBehavior) {
        alert("Please select Clay-like or Sand-like when the current value is 0.5.");
        return false;
    }

    return true;
}

function loadSavedAnswer(q) {
    if (!responses[q]) return;

    const r = responses[q];

    if (r.behavior === "data not usable") {
        document.querySelector(`input[name="behavior_${q}"][value="data not usable"]`).checked = true;
        updateSliderVisibility(q);
    } else {
        document.querySelector(`input[name="behavior_${q}"][value="slider"]`).checked = true;
        updateSliderVisibility(q);

        document.getElementById(`slider_${q}`).value = r.slider;
        document.getElementById(`stddev_${q}`).value = r.stddev;
    }

    document.getElementById(`comments_${q}`).value = r.comments || "";
}

// ------------------ SUBMIT TO FIRESTORE ------------------

async function submitForm() {

    if (!currentUser) {
        alert("Please sign in first.");
        return;
    }

    // ✅ Step 2B.2: email-only users cannot submit to Firestore
    if (currentUser?.isLocalUser) {
        alert("Email-only mode cannot submit to Firebase. Please use Google Sign-In.");
        return;
    }

    const name = document.getElementById("researcher-name").value.trim();

    const payload = {
        uid: currentUser.uid,
        email: currentUser.email,
        name: name,
        responses: responses,
        submittedAt: new Date().toISOString()
    };

    try {
        console.log("Saving to Firestore:", currentUser.uid);
        console.log("SUBMIT ATTEMPT UID:", currentUser.uid);
        await db.collection("responses_all_tests").doc(currentUser.uid).set(payload);
        alert("Your responses have been saved!");

    } catch (error) {
        console.error("Firestore error:", error);
        alert("Error saving data: " + error.message);
    }
}

async function goToPage(currentQuestionNumber, nextPageIndex) {
    // Save locally
    if (currentQuestionNumber >= 1 && currentQuestionNumber <= cachedQuestions.length) {
        if (!validateQuestion(currentQuestionNumber)) return;
        saveAnswer(currentQuestionNumber);
    }

    // 🔥 Auto-save to Firestore
    await saveProgressToFirestore();

    // Navigate
    navigatePage(nextPageIndex);
}

function downloadExcel() {
    if (!currentUser || !responses) {
        alert("Please submit responses first.");
        return;
    }

    // Create array for Excel
    const excelData = [];

    excelData.push(["Researcher Name", document.getElementById("researcher-name").value]);
    excelData.push(["Email", currentUser.email]);
    excelData.push([]);
    excelData.push(["Question #", "Top Behavior", "Behavior", "Slider", "Std Dev", "Comments"]);

    // Loop through each question
    Object.keys(responses).forEach(q => {
        excelData.push([
            q,
            responses[q].top_behavior || "",
            responses[q].behavior || "",
            responses[q].slider || "",
            responses[q].stddev || "",
            responses[q].comments || ""
        ]);
    });

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Responses");

    // Generate file name
    const fileName = `responses_${currentUser.uid}.xlsx`;

    // Trigger download
    XLSX.writeFile(workbook, fileName);
}