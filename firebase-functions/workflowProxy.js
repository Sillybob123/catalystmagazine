/**
 * Cloud Function Proxy for Cross-Project Firestore Access
 *
 * This function authenticates the user from catalystwriters-5ce43,
 * then reads data from catalystmonday on their behalf.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize primary app (default)
admin.initializeApp();

// Initialize secondary app for catalystmonday
const workflowApp = admin.initializeApp(
  {
    credential: admin.credential.cert(require('./catalystmonday-service-account.json')),
    projectId: 'catalystmonday'
  },
  'workflow'
);

const workflowDb = workflowApp.firestore();

/**
 * Get workflow projects from catalystmonday database
 */
exports.getWorkflowProjects = functions.https.onCall(async (data, context) => {
  // Verify user is authenticated in catalystwriters-5ce43
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to access workflow data'
    );
  }

  try {
    // Fetch projects from catalystmonday database
    const projectsSnapshot = await workflowDb.collection('projects').get();

    const projects = projectsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      projects: projects
    };
  } catch (error) {
    console.error('Error fetching workflow projects:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to fetch workflow projects',
      error.message
    );
  }
});

/**
 * Get workflow tasks from catalystmonday database
 */
exports.getWorkflowTasks = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to access workflow data'
    );
  }

  try {
    const tasksSnapshot = await workflowDb.collection('tasks').get();

    const tasks = tasksSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      tasks: tasks
    };
  } catch (error) {
    console.error('Error fetching workflow tasks:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to fetch workflow tasks',
      error.message
    );
  }
});
